import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import axios from 'axios';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useJobStore, Step } from '../store/useJobStore';

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

interface ProcedureStep {
  step_number: number;
  instruction_text: string;
  expected_duration_sec?: number;
  safety_warning?: string;
}

interface ProcedureDetail {
  _id: string;
  title: string;
  description?: string;
  equipment?: string;
  location?: string;
  assetId?: string;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  steps: ProcedureStep[];
}

export default function WorkOrderDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ procedure_id?: string }>();
  const procedureId = params.procedure_id;

  const { availableJobs, setActiveJob } = useJobStore();

  const [procedure, setProcedure] = useState<ProcedureDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStartingJob, setIsStartingJob] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Fetch Procedure Details on Mount
   */
  useEffect(() => {
    async function loadProcedureDetails() {
      if (!procedureId) {
        setErrorMessage('No procedure ID provided.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);

        console.log(`[WorkOrderDetails] Fetching procedure: ${FASTIFY_SERVER_URL}/procedures/${procedureId}`);
        const response = await axios.get(`${FASTIFY_SERVER_URL}/procedures/${procedureId}`, {
          timeout: 10000,
        });

        if (response.data?.success && response.data?.data) {
          const fetchedData = response.data.data;
          setProcedure({
            _id: fetchedData._id || procedureId,
            title: fetchedData.title || 'Equipment Inspection',
            description: fetchedData.description || 'Follow standard operating procedure instructions.',
            equipment: fetchedData.equipment || 'Machinery Unit',
            location: fetchedData.location || 'Facility Workcell',
            assetId: fetchedData.assetId || fetchedData._id?.slice(-8).toUpperCase() || 'ASSET-01',
            priority: fetchedData.priority || 'HIGH',
            steps: fetchedData.steps || [],
          });
        } else {
          throw new Error('Invalid response structure from server.');
        }
      } catch (err: any) {
        console.warn('[WorkOrderDetails] Server fetch notice:', err.message);

        // Fallback: Check local store for available job matching this ID
        const localJob = availableJobs.find((j) => j.id === procedureId);
        if (localJob) {
          setProcedure({
            _id: localJob.id,
            title: localJob.title,
            description: `Assigned inspection checklist for ${localJob.equipment || 'Equipment'}.`,
            equipment: localJob.equipment,
            location: localJob.location,
            assetId: localJob.assetId || localJob.id.slice(-8).toUpperCase(),
            priority: localJob.priority,
            steps: localJob.steps.map((st) => ({
              step_number: st.stepNumber,
              instruction_text: st.instruction || st.title,
            })),
          });
        } else {
          setErrorMessage(err.message || 'Failed to load work order details.');
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadProcedureDetails();
  }, [procedureId, availableJobs]);

  /**
   * Start Job Session & Launch AI Camera Loop
   */
  const handleStartJob = async () => {
    if (!procedure) return;

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsStartingJob(true);

      let sessionId = `session_${Date.now()}`;

      try {
        console.log(`[WorkOrderDetails] Starting session at ${FASTIFY_SERVER_URL}/sessions/start...`);
        const sessionResponse = await axios.post(`${FASTIFY_SERVER_URL}/sessions/start`, {
          procedure_id: procedure._id,
          socket_id: 'mobile_technician',
        });

        if (sessionResponse.data?.session_id) {
          sessionId = sessionResponse.data.session_id;
        }
      } catch (sessionErr: any) {
        console.warn('[WorkOrderDetails] Session start fallback notice:', sessionErr?.message);
      }

      // Map steps to Zustand store
      const mappedSteps: Step[] = procedure.steps.map((s) => ({
        stepNumber: s.step_number,
        title: `Step ${s.step_number}`,
        instruction: s.instruction_text + (s.safety_warning ? ` (⚠️ ${s.safety_warning})` : ''),
        status: s.step_number === 1 ? 'IN_PROGRESS' : 'PENDING',
      }));

      setActiveJob({
        id: procedure._id,
        title: procedure.title,
        equipment: procedure.equipment || 'Industrial Equipment',
        location: procedure.location || 'Facility Workcell',
        priority: procedure.priority || 'HIGH',
        assetId: procedure.assetId,
        steps: mappedSteps.length > 0 ? mappedSteps : [
          {
            stepNumber: 1,
            title: 'Visual Inspection',
            instruction: 'Inspect equipment per standard operating procedure.',
            status: 'IN_PROGRESS',
          },
        ],
      });

      setIsStartingJob(false);

      // Navigate to Active Job AI Camera Screen
      router.push({
        pathname: '/active-job',
        params: {
          session_id: sessionId,
          procedure_id: procedure._id,
          work_order_id: procedure._id,
        },
      });
    } catch (err: any) {
      console.error('[WorkOrderDetails] Start job error:', err);
      setIsStartingJob(false);
      setErrorMessage(err.message || 'Failed to start AI session.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />

      {/* Top Navigation Header */}
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
          <Text style={styles.headerBadgeText}>WORK ORDER DETAILS</Text>
          <Text style={styles.headerTitle}>Task Overview</Text>
        </View>

        {procedure?.assetId && (
          <View style={styles.assetPill}>
            <Text style={styles.assetPillText}>{procedure.assetId}</Text>
          </View>
        )}
      </View>

      {/* Error Banner */}
      {errorMessage && (
        <View style={styles.errorContainer}>
          <BlurView intensity={80} tint="dark" style={styles.errorBlur}>
            <Feather name="alert-circle" size={18} color="#F87171" style={{ marginRight: 8 }} />
            <Text style={styles.errorText} numberOfLines={2}>{errorMessage}</Text>
          </BlurView>
        </View>
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <BlurView intensity={80} tint="dark" style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={styles.loadingText}>Fetching procedure steps...</Text>
          </BlurView>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Procedure Summary Card */}
          {procedure && (
            <BlurView intensity={80} tint="dark" style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <View style={styles.priorityBadge}>
                  <Text style={styles.priorityBadgeText}>{procedure.priority || 'HIGH'} PRIORITY</Text>
                </View>
                <Text style={styles.stepsCountBadge}>
                  {procedure.steps.length} {procedure.steps.length === 1 ? 'Step' : 'Steps'}
                </Text>
              </View>

              <Text style={styles.procedureTitle}>{procedure.title}</Text>
              <Text style={styles.procedureDesc}>{procedure.description}</Text>

              {procedure.location && (
                <View style={styles.locationRow}>
                  <Feather name="map-pin" size={14} color="#94A3B8" style={{ marginRight: 6 }} />
                  <Text style={styles.locationText}>{procedure.location}</Text>
                </View>
              )}
            </BlurView>
          )}

          {/* Checklist Steps Section */}
          <View style={styles.stepsSectionHeader}>
            <Text style={styles.stepsSectionTitle}>INSPECTION CHECKLIST</Text>
            <Text style={styles.stepsSectionSubtitle}>
              Review the required steps before starting the camera stream
            </Text>
          </View>

          {/* Step Cards List */}
          {procedure?.steps && procedure.steps.length > 0 ? (
            procedure.steps.map((step, index) => (
              <BlurView
                key={`step-${step.step_number || index}`}
                intensity={75}
                tint="dark"
                style={styles.stepCard}
              >
                <View style={styles.stepCardHeader}>
                  <View style={styles.stepNumberBadge}>
                    <Text style={styles.stepNumberText}>STEP {step.step_number || index + 1}</Text>
                  </View>
                  {step.expected_duration_sec && (
                    <View style={styles.durationRow}>
                      <Feather name="clock" size={12} color="#94A3B8" style={{ marginRight: 4 }} />
                      <Text style={styles.durationText}>{step.expected_duration_sec}s</Text>
                    </View>
                  )}
                </View>

                {/* Instruction Text */}
                <Text style={styles.stepInstructionText}>{step.instruction_text}</Text>

                {/* Safety Warning if available */}
                {step.safety_warning && (
                  <View style={styles.safetyWarningBox}>
                    <Feather name="alert-triangle" size={16} color="#F87171" style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.safetyWarningTitle}>SAFETY WARNING</Text>
                      <Text style={styles.safetyWarningText}>{step.safety_warning}</Text>
                    </View>
                  </View>
                )}
              </BlurView>
            ))
          ) : (
            <BlurView intensity={70} tint="dark" style={styles.emptyStepsCard}>
              <Feather name="info" size={24} color="#94A3B8" style={{ marginBottom: 8 }} />
              <Text style={styles.emptyStepsText}>
                Standard visual inspection procedure with AI copilot verification.
              </Text>
            </BlurView>
          )}
        </ScrollView>
      )}

      {/* Fixed Bottom Action Bar (Thumb Zone) */}
      {!isLoading && procedure && (
        <SafeAreaView edges={['bottom']} style={styles.bottomBarSafeArea}>
          <TouchableOpacity
            style={styles.startJobButton}
            onPress={handleStartJob}
            activeOpacity={0.85}
          >
            <BlurView intensity={90} tint="dark" style={styles.startJobBlur}>
              <View style={styles.startJobIconRing}>
                <Feather name="play" size={22} color="#FFFFFF" style={{ marginLeft: 2 }} />
              </View>
              <Text style={styles.startJobButtonText}>START JOB</Text>
            </BlurView>
          </TouchableOpacity>
        </SafeAreaView>
      )}

      {/* Fullscreen Initializing AI Engine Loading Overlay */}
      {isStartingJob && (
        <View style={styles.initializingOverlay}>
          <BlurView intensity={95} tint="dark" style={styles.initializingCard}>
            <View style={styles.initializingIconCircle}>
              <ActivityIndicator size="large" color="#10B981" />
            </View>
            <Text style={styles.initializingTitle}>Initializing AI Engine...</Text>
            <Text style={styles.initializingSubtitle}>
              Connecting to Gemini Vision Gateway & starting live inspection session
            </Text>
            <View style={styles.initializingBadge}>
              <View style={styles.initializingDot} />
              <Text style={styles.initializingBadgeText}>Readying Copilot HUD</Text>
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
  headerBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  assetPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  assetPillText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorContainer: {
    marginHorizontal: 20,
    marginBottom: 12,
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 110,
    paddingTop: 4,
  },
  summaryCard: {
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  priorityBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  priorityBadgeText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  stepsCountBadge: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  procedureTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  procedureDesc: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  locationText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  stepsSectionHeader: {
    marginBottom: 14,
  },
  stepsSectionTitle: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  stepsSectionSubtitle: {
    color: '#64748B',
    fontSize: 12,
  },
  stepCard: {
    borderRadius: 16,
    padding: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    marginBottom: 12,
  },
  stepCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  stepNumberBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  stepNumberText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  stepInstructionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  safetyWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    marginTop: 12,
  },
  safetyWarningTitle: {
    color: '#F87171',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  safetyWarningText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  emptyStepsCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptyStepsText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loadingCard: {
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  bottomBarSafeArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 16,
    zIndex: 40,
  },
  startJobButton: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  startJobBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
  },
  startJobIconRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  startJobButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  initializingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 999,
  },
  initializingCard: {
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
  initializingIconCircle: {
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
  initializingTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  initializingSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  initializingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  initializingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  initializingBadgeText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
});
