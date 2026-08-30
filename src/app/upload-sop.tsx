import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import axios from 'axios';
import Constants from 'expo-constants';
import { useJobStore } from '../store/useJobStore';

// Dynamic server URL helper
const getFastifyServerUrl = () => {
  const debuggerHost =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;
  if (debuggerHost) {
    const ip = debuggerHost.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:3000/api`;
    }
  }
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${host}:3000/api`;
};

const FASTIFY_SERVER_URL = getFastifyServerUrl();

interface SelectedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export default function UploadSopScreen() {
  const router = useRouter();
  const { setActiveJob } = useJobStore();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('Extracting steps & voice guidance...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 1. Take Photo of Physical Manual
   */
  const handleTakePhoto = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setErrorMessage(null);
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to photograph manuals.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const file: SelectedFile = {
          uri: asset.uri,
          name: asset.fileName || `manual_photo_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
        };

        await uploadAndProcessManual(file);
      }
    } catch (err: any) {
      console.error('[UploadSOP] Camera error:', err);
      setErrorMessage(err.message || 'Failed to capture photo.');
    }
  };

  /**
   * 2. Upload PDF Document Manual
   */
  const handlePickDocument = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setErrorMessage(null);
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const file: SelectedFile = {
          uri: asset.uri,
          name: asset.name || `manual_${Date.now()}.pdf`,
          mimeType: asset.mimeType || (asset.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          size: asset.size,
        };

        await uploadAndProcessManual(file);
      }
    } catch (err: any) {
      console.error('[UploadSOP] Document picker error:', err);
      setErrorMessage(err.message || 'Failed to select document.');
    }
  };

  /**
   * 3. Upload FormData to Fastify -> LangChain Gemini -> Start Session -> Active Job
   */
  const uploadAndProcessManual = async (file: SelectedFile) => {
    setIsLoading(true);
    setLoadingMessage('Uploading manual to AI engine...');
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as any);

      console.log(`[UploadSOP] Uploading to ${FASTIFY_SERVER_URL}/procedures/upload-custom...`);
      setLoadingMessage('Multimodal AI extracting steps & Hinglish voice...');

      const uploadResponse = await axios.post(
        `${FASTIFY_SERVER_URL}/procedures/upload-custom`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 45000,
        }
      );

      const procedureId = uploadResponse.data?.procedure_id;
      const procedureData = uploadResponse.data?.procedure;

      if (!procedureId || !procedureData) {
        throw new Error('Server did not return a valid procedure ID.');
      }

      console.log(`[UploadSOP] ✅ Procedure created: ${procedureId} ("${procedureData.title}")`);
      setLoadingMessage('Initializing Live AI Copilot session...');

      let sessionId = `session_${Date.now()}`;
      try {
        const sessionResponse = await axios.post(`${FASTIFY_SERVER_URL}/sessions/start`, {
          procedure_id: procedureId,
          socket_id: 'mobile_technician',
        });
        if (sessionResponse.data?.session_id) {
          sessionId = sessionResponse.data.session_id;
        }
      } catch (sessionErr) {
        console.warn('[UploadSOP] Session initialization fallback:', sessionErr);
      }

      const mappedSteps = (procedureData.steps || []).map((st: any) => ({
        stepNumber: st.step_number,
        title: `Step ${st.step_number}`,
        instruction: st.instruction_text + (st.safety_warning ? ` (⚠️ ${st.safety_warning})` : ''),
        status: st.step_number === 1 ? ('IN_PROGRESS' as const) : ('PENDING' as const),
      }));

      setActiveJob({
        id: procedureId,
        title: procedureData.title,
        equipment: 'Custom Digitized SOP',
        location: 'Facility Workcell',
        priority: 'HIGH',
        assetId: 'CUSTOM-SOP',
        steps: mappedSteps.length > 0 ? mappedSteps : [
          {
            stepNumber: 1,
            title: 'Visual Inspection',
            instruction: 'Inspect equipment per standard instructions.',
            status: 'IN_PROGRESS',
          },
        ],
      });

      setIsLoading(false);

      router.replace({
        pathname: '/active-job',
        params: {
          session_id: sessionId,
          procedure_id: procedureId,
        },
      });
    } catch (err: any) {
      console.error('[UploadSOP] Upload error:', err);
      setIsLoading(false);
      const msg = axios.isAxiosError(err)
        ? `Server Error (${err.response?.status || err.code}): ${err.response?.data?.error || err.message}`
        : err.message || 'Failed to process document.';
      setErrorMessage(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />

      {/* Top Navigation Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <BlurView intensity={80} tint="dark" style={styles.backButtonBlur}>
            <Feather name="arrow-left" size={20} color="#FFFFFF" />
          </BlurView>
        </TouchableOpacity>

        <View style={styles.headerTitleWrapper}>
          <Text style={styles.headerTitle}>Generate Dynamic SOP</Text>
          <Text style={styles.headerSubtitle}>Digitize physical manuals into AI checklists</Text>
        </View>
      </View>

      {/* Error Alert Banner */}
      {errorMessage && (
        <View style={styles.errorContainer}>
          <BlurView intensity={80} tint="dark" style={styles.errorBlur}>
            <Feather name="alert-circle" size={18} color="#F87171" style={{ marginRight: 8 }} />
            <Text style={styles.errorText} numberOfLines={2}>{errorMessage}</Text>
          </BlurView>
        </View>
      )}

      {/* Two Massive 40% Height Dropzone Cards */}
      <View style={styles.dropzoneContainer}>
        {/* Top Dropzone: Camera */}
        <TouchableOpacity
          style={styles.dropzoneTouchable}
          onPress={handleTakePhoto}
          activeOpacity={0.8}
        >
          <BlurView intensity={85} tint="dark" style={styles.dropzoneBlur}>
            <View style={styles.iconCircle}>
              <Feather name="camera" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.dropzoneTitle}>Take Photo of Manual</Text>
            <Text style={styles.dropzoneDesc}>
              Photograph physical machinery manuals, placards, or schematics
            </Text>
            <View style={styles.actionPill}>
              <Text style={styles.actionPillText}>Open Camera</Text>
              <Feather name="arrow-right" size={14} color="#10B981" />
            </View>
          </BlurView>
        </TouchableOpacity>

        {/* Bottom Dropzone: PDF */}
        <TouchableOpacity
          style={styles.dropzoneTouchable}
          onPress={handlePickDocument}
          activeOpacity={0.8}
        >
          <BlurView intensity={85} tint="dark" style={styles.dropzoneBlur}>
            <View style={[styles.iconCircle, styles.iconCirclePdf]}>
              <Feather name="file-text" size={48} color="#FFFFFF" />
            </View>
            <Text style={styles.dropzoneTitle}>Upload PDF</Text>
            <Text style={styles.dropzoneDesc}>
              Import digital service manuals, tech sheets, or equipment specs
            </Text>
            <View style={styles.actionPill}>
              <Text style={styles.actionPillText}>Browse Files</Text>
              <Feather name="arrow-right" size={14} color="#10B981" />
            </View>
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* Fullscreen Loading Glassmorphism Overlay */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <BlurView intensity={90} tint="dark" style={styles.loadingCard}>
            <View style={styles.loadingSpinnerRing}>
              <ActivityIndicator size="large" color="#10B981" />
            </View>
            <Text style={styles.loadingTitle}>Analyzing SOP...</Text>
            <Text style={styles.loadingSubtitle}>{loadingMessage}</Text>
            <View style={styles.loadingBadge}>
              <View style={styles.loadingDot} />
              <Text style={styles.loadingBadgeText}>Multimodal AI Processing</Text>
            </View>
          </BlurView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backButton: {
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 14,
  },
  backButtonBlur: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  headerTitleWrapper: {
    flex: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  errorContainer: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
  },
  errorBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    flex: 1,
  },
  dropzoneContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  dropzoneTouchable: {
    height: '48%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  dropzoneBlur: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  iconCirclePdf: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  dropzoneTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  dropzoneDesc: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 6,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 999,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    shadowColor: '#10B981',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  loadingSpinnerRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  loadingTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  loadingSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  loadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  loadingBadgeText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
});
