import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Accelerometer } from 'expo-sensors';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useJobStore } from '../store/useJobStore';

// Dynamic server URL resolver for physical devices, emulators, and Expo Go
const getFastifySocketUrl = (): string => {
  const debuggerHost =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (debuggerHost) {
    const ip = debuggerHost.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:3000`;
    }
  }

  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${host}:3000`;
};

export type InspectionStatus =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'HAZARD'
  | 'INVALID_VIEW'
  | 'IMAGE_UNCLEAR'
  | 'FAILED'
  | 'PROCESSING'
  | 'IDLE';

export interface AIVerdictPayload {
  status: 'COMPLETED' | 'IN_PROGRESS' | 'HAZARD' | 'INVALID_VIEW' | 'IMAGE_UNCLEAR' | 'FAILED' | 'PROCESSING';
  confidence: number;
  feedback_hinglish: string;
  next_step_text?: string;
  current_step_index: number;
  total_steps: number;
  jobId?: string;
  workOrderId?: string;
  stepNumber?: number;
  processingTimeMs?: number;
  timestamp?: string;
}

export default function ActiveJobScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ procedure_id?: string; work_order_id?: string; session_id?: string }>();
  const cameraRef = useRef<CameraView>(null);
  const socketRef = useRef<Socket | null>(null);
  const evaluationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Camera permissions & Torch
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);

  // In-Flight Lock & State Management
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const isEvaluatingRef = useRef<boolean>(false);
  const [aiStatus, setAiStatus] = useState<InspectionStatus>('IDLE');
  const [latestFeedback, setLatestFeedback] = useState<string>(
    'Copilot ready. Point camera at inspection target.'
  );
  const [frameCounter, setFrameCounter] = useState<number>(0);
  const [networkToast, setNetworkToast] = useState<string | null>(null);

  // Step Progression, Hazard & Pause States
  const [currentStepText, setCurrentStepText] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [isHazardMode, setIsHazardMode] = useState<boolean>(false);
  const [hazardMessage, setHazardMessage] = useState<string>('');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [pauseReason, setPauseReason] = useState<string>('');
  const [showSuccessBadge, setShowSuccessBadge] = useState<boolean>(false);

  // Animated pulse for AI status indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Global Zustand Store
  const {
    work_order_id,
    active_step_number,
    steps,
    connection_status,
    nextStep,
    prevStep,
    setStepNumber,
    setConnectionStatus,
    setAiSpeaking,
  } = useJobStore();

  const currentStep = steps.find((s) => s.stepNumber === active_step_number) || steps[0];
  const totalStepsCount = steps.length || 1;

  // Pulsing animation for status dot
  useEffect(() => {
    if (!isPaused && !isHazardMode) {
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.35,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.start();
      return () => pulseLoop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isPaused, isHazardMode, pulseAnim]);

  // Synchronize currentStepText & progress
  useEffect(() => {
    if (currentStep) {
      setCurrentStepText(currentStep.instruction || currentStep.title);
      const calculatedProgress = Math.min(
        Math.max((active_step_number - 1) / totalStepsCount, 0),
        1
      );
      setProgress(calculatedProgress);
    }
  }, [currentStep, active_step_number, totalStepsCount]);

  // Natural Hinglish Speech Output
  const speakVerdict = useCallback(
    (text: string) => {
      if (!text) return;
      try {
        Speech.stop();
        setAiSpeaking(true, text);

        Speech.speak(text, {
          language: 'hi-IN',
          pitch: 1.0,
          rate: 0.9,
          onDone: () => setAiSpeaking(false),
          onError: () => {
            Speech.speak(text, {
              language: 'en-IN',
              pitch: 1.0,
              rate: 0.9,
              onDone: () => setAiSpeaking(false),
              onError: () => setAiSpeaking(false),
            });
          },
        });
      } catch (err) {
        console.warn('[TTS] Speech notice:', err);
        setAiSpeaking(false);
      }
    },
    [setAiSpeaking]
  );

  // Sync refs with state
  const isPausedRef = useRef<boolean>(false);
  useEffect(() => {
    isEvaluatingRef.current = isEvaluating;
  }, [isEvaluating]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // -------------------------------------------------------------
  // Hardware Sensor: Face-Down Detection via Accelerometer
  // -------------------------------------------------------------
  useEffect(() => {
    Accelerometer.setUpdateInterval(800);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const isFaceDown = z < -0.85 && Math.abs(x) < 0.2 && Math.abs(y) < 0.2;

      if (isFaceDown && !isPausedRef.current && !isHazardMode) {
        console.log('[Sensor] 📱 Hardware Face-Down detected! Pausing camera loop.');

        isPausedRef.current = true;
        setIsPaused(true);
        setPauseReason('Device placed face-down on surface.');

        // Lock camera capture loop
        isEvaluatingRef.current = true;
        setIsEvaluating(true);

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

        const ttsMessage = 'Device placed down. Camera paused.';
        setLatestFeedback(ttsMessage);
        speakVerdict(ttsMessage);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isHazardMode, speakVerdict]);

  // Keep screen awake during active inspection
  useEffect(() => {
    try {
      const KeepAwake = require('expo-keep-awake');
      if (KeepAwake?.activateKeepAwakeAsync) {
        KeepAwake.activateKeepAwakeAsync().catch(() => {});
      }
      return () => {
        if (KeepAwake?.deactivateKeepAwake) {
          KeepAwake.deactivateKeepAwake().catch(() => {});
        }
      };
    } catch {}
  }, []);

  // Request Camera Permissions on Mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission().catch((err) => console.log('[Camera] Permission error:', err));
    }
  }, [permission, requestPermission]);

  // -------------------------------------------------------------
  // 1. Socket.IO Client Setup & Event Listeners
  // -------------------------------------------------------------
  useEffect(() => {
    const socketUrl = getFastifySocketUrl();
    console.log(`[Socket.IO] Connecting to WebSocket Gateway: ${socketUrl}`);
    setConnectionStatus('connecting');

    const socket: Socket = io(socketUrl, {
      transports: ['websocket'],
      upgrade: false,
      autoConnect: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', async () => {
      console.log(`[Socket.IO] Connected successfully (Socket ID: ${socket.id})`);
      setConnectionStatus('connected');
      setNetworkToast(null);

      const targetProcedureId = params.procedure_id || work_order_id;
      if (targetProcedureId) {
        try {
          const apiBase = getFastifySocketUrl() + '/api';
          await axios.post(`${apiBase}/sessions/start`, {
            procedure_id: targetProcedureId,
            socket_id: socket.id,
          });
          console.log(`[ActiveJob] Linked session in DB: socket ${socket.id} -> procedure ${targetProcedureId}`);
        } catch (sessionErr: any) {
          console.warn('[ActiveJob] Session start notice:', sessionErr.message);
        }
      }

      if (work_order_id) {
        socket.emit('join_stream', {
          workOrderId: work_order_id,
          role: 'publisher',
          workerName: 'Field Worker',
        });
      }
    });

    // -------------------------------------------------------------
    // 2. Handle 'ai_verdict' Event
    // -------------------------------------------------------------
    const handleAIVerdict = async (data: AIVerdictPayload | string) => {
      try {
        if (evaluationTimeoutRef.current) {
          clearTimeout(evaluationTimeoutRef.current);
          evaluationTimeoutRef.current = null;
        }

        const payload: AIVerdictPayload = typeof data === 'string' ? JSON.parse(data) : data;
        console.log('[Socket.IO] 🧠 Received AI Verdict:', payload);

        setAiStatus(payload.status);

        // A. HAZARD HANDLING & HAPTICS
        if (payload.status === 'HAZARD') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

          setIsHazardMode(true);
          setHazardMessage(payload.feedback_hinglish || 'HAZARD DETECTED! STOP WORK IMMEDIATELY.');

          isEvaluatingRef.current = true;
          setIsEvaluating(true);

          if (payload.feedback_hinglish) {
            setLatestFeedback(payload.feedback_hinglish);
            speakVerdict(payload.feedback_hinglish);
          }
          return;
        }

        // B. STEP COMPLETED HANDLING
        if (payload.status === 'COMPLETED') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          setShowSuccessBadge(true);
          setTimeout(() => setShowSuccessBadge(false), 2500);

          if (payload.next_step_text) {
            setCurrentStepText(payload.next_step_text);
          }

          if (payload.current_step_index !== undefined) {
            setStepNumber(payload.current_step_index + 1);
          } else if (payload.stepNumber !== undefined) {
            setStepNumber(payload.stepNumber);
          }

          if (payload.total_steps && payload.current_step_index !== undefined) {
            setProgress(Math.min(payload.current_step_index / payload.total_steps, 1));
          }
        }

        // C. IMAGE_UNCLEAR / IN_PROGRESS / NORMAL FEEDBACK
        if (payload.feedback_hinglish) {
          setLatestFeedback(payload.feedback_hinglish);
          speakVerdict(payload.feedback_hinglish);
        }
      } catch (err) {
        console.error('[Socket.IO] Error parsing AI verdict:', err);
      } finally {
        if (!isHazardMode && !isPausedRef.current) {
          isEvaluatingRef.current = false;
          setIsEvaluating(false);
        }
      }
    };

    // -------------------------------------------------------------
    // 2b. Handle 'pause_loop' Event (Three-Strike System)
    // -------------------------------------------------------------
    const handlePauseLoop = async (data: { reason?: string } | string) => {
      try {
        if (evaluationTimeoutRef.current) {
          clearTimeout(evaluationTimeoutRef.current);
          evaluationTimeoutRef.current = null;
        }

        const payload = typeof data === 'string' ? JSON.parse(data) : data;
        const reason = payload?.reason || 'No equipment detected for a while. Pausing to save data.';
        console.log('[Socket.IO] ⏸️ Received pause_loop event:', payload);

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setIsPaused(true);
        setPauseReason(reason);

        isEvaluatingRef.current = true;
        setIsEvaluating(true);

        const ttsMessage = 'Camera paused. Tap resume when ready.';
        setLatestFeedback(ttsMessage);
        speakVerdict(ttsMessage);
      } catch (err) {
        console.error('[Socket.IO] Error handling pause_loop:', err);
      }
    };

    socket.on('ai_verdict', handleAIVerdict);
    socket.on('ai_response', handleAIVerdict);
    socket.on('frame_processed', handleAIVerdict);
    socket.on('pause_loop', handlePauseLoop);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Disconnected: ${reason}`);
      setConnectionStatus('disconnected');

      if (evaluationTimeoutRef.current) {
        clearTimeout(evaluationTimeoutRef.current);
        evaluationTimeoutRef.current = null;
      }
      if (!isHazardMode && !isPausedRef.current) {
        isEvaluatingRef.current = false;
        setIsEvaluating(false);
      }

      setNetworkToast('Network lost. Reconnecting...');
    });

    socket.on('connect_error', (error) => {
      console.warn(`[Socket.IO] Connection Error: ${error.message}`);
      setConnectionStatus('error');
    });

    return () => {
      Speech.stop();
      if (evaluationTimeoutRef.current) {
        clearTimeout(evaluationTimeoutRef.current);
        evaluationTimeoutRef.current = null;
      }
      socket.off('ai_verdict', handleAIVerdict);
      socket.off('ai_response', handleAIVerdict);
      socket.off('frame_processed', handleAIVerdict);
      socket.off('pause_loop', handlePauseLoop);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [work_order_id, isHazardMode, setConnectionStatus, setStepNumber, speakVerdict]);

  // -------------------------------------------------------------
  // 3. Discrete Frame Capture Loop (3-Second Interval)
  // -------------------------------------------------------------
  useEffect(() => {
    const captureInterval = setInterval(async () => {
      if (
        isPaused ||
        isEvaluatingRef.current ||
        isHazardMode ||
        !socketRef.current?.connected ||
        !permission?.granted ||
        !cameraRef.current ||
        !isCameraReady
      ) {
        return;
      }

      try {
        if (!cameraRef.current) return;

        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.5,
          shutterSound: false,
        });

        if (!photo?.uri) return;

        const context = ImageManipulator.manipulate(photo.uri);
        const imageRef = await context.resize({ width: 640 }).renderAsync();
        const manipulated = await imageRef.saveAsync({
          compress: 0.3,
          format: SaveFormat.JPEG,
          base64: true,
        });

        if (!manipulated.base64) return;

        isEvaluatingRef.current = true;
        setIsEvaluating(true);
        setFrameCounter((prev) => prev + 1);

        if (evaluationTimeoutRef.current) {
          clearTimeout(evaluationTimeoutRef.current);
        }

        // 8000ms Failsafe Timeout against Zombie Locks
        evaluationTimeoutRef.current = setTimeout(() => {
          if (isEvaluatingRef.current && !isHazardMode && !isPausedRef.current) {
            console.warn('[ActiveJob] ⚠️ Evaluation timeout reached (8000ms). Releasing zombie lock.');
            isEvaluatingRef.current = false;
            setIsEvaluating(false);
            const slowMsg = 'Connection slow, retrying...';
            setLatestFeedback(slowMsg);
            setNetworkToast(slowMsg);
            setTimeout(() => setNetworkToast(null), 3000);
          }
        }, 8000);

        socketRef.current.volatile.emit('process_frame', manipulated.base64);
      } catch (err: any) {
        if (!isHazardMode && !isPaused) {
          isEvaluatingRef.current = false;
          setIsEvaluating(false);
        }
        console.warn('[Camera] Frame capture notice:', err?.message || err);
      }
    }, 3000);

    return () => clearInterval(captureInterval);
  }, [permission, isCameraReady, isHazardMode, isPaused, frameCounter]);

  // Flashlight toggle
  const toggleFlashlight = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsTorchOn((prev) => !prev);
  };

  // Toggle Pause/Resume AI
  const togglePauseAI = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPaused) {
      setIsPaused(false);
      isEvaluatingRef.current = false;
      setIsEvaluating(false);
      setLatestFeedback('Camera loop resumed. Pointing at equipment.');
    } else {
      setIsPaused(true);
      setPauseReason('Paused manually by technician.');
      isEvaluatingRef.current = true;
      setIsEvaluating(true);
      setLatestFeedback('AI evaluation paused.');
      speakVerdict('Camera paused.');
    }
  };

  // Dismiss Hazard Alert & Resume Camera Loop
  const handleDismissHazard = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsHazardMode(false);
    isEvaluatingRef.current = false;
    setIsEvaluating(false);
    setLatestFeedback('Hazard cleared. Resuming inspection stream.');
  };

  // Resume Paused Camera Loop
  const handleResumeCamera = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsPaused(false);
    isEvaluatingRef.current = false;
    setIsEvaluating(false);
    setLatestFeedback('Camera loop resumed. Pointing at equipment.');
  };

  // Undo / Previous Step
  const handleUndoStep = async () => {
    if (active_step_number <= 1) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    prevStep();
  };

  // Manual Force Skip Step Override
  const handleForceSkip = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    console.log('[ActiveJob] Manual Force Skip triggered by technician');

    socketRef.current?.emit('force_skip', {
      workOrderId: work_order_id,
      currentStep: active_step_number,
    });

    nextStep();
    setShowSuccessBadge(true);
    setTimeout(() => setShowSuccessBadge(false), 2000);
  };

  const handleExit = () => {
    Speech.stop();
    router.back();
  };

  return (
    <View style={[styles.rootContainer, isHazardMode && styles.rootContainerHazard]}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* 1. Full-Screen Camera Feed */}
      {permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={isTorchOn}
          onCameraReady={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={styles.permissionContainer}>
          <View style={styles.permissionIconCircle}>
            <Ionicons name="camera-outline" size={32} color="#38bdf8" />
          </View>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionSubtitle}>
            Zenith Copilot needs camera access to guide step-by-step inspections.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 2. Top Section HUD (Progress & Status) */}
      <SafeAreaView edges={['top']} style={styles.topSafeArea}>
        {/* Sleek Minimal Progress Bar at very top */}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.round(progress * 100)}%` },
              isHazardMode && styles.progressBarFillHazard,
            ]}
          />
        </View>

        {/* Top Floating Glass HUD Bar */}
        <View style={styles.topBarRow}>
          {/* Step Counter Pill with Pulsing Status Indicator */}
          <BlurView intensity={80} tint="dark" style={styles.stepCounterPill}>
            <Animated.View
              style={[
                styles.pulsingDot,
                {
                  opacity: pulseAnim,
                  backgroundColor: isHazardMode
                    ? '#ef4444'
                    : isPaused
                    ? '#64748b'
                    : connection_status === 'connected'
                    ? '#22c55e'
                    : '#f59e0b',
                },
              ]}
            />
            <Text style={styles.stepCounterText}>
              Step {active_step_number} of {totalStepsCount}
            </Text>
            <View style={styles.pillDivider} />
            <Text style={styles.connectionStatusText}>
              {isHazardMode
                ? 'HAZARD'
                : isPaused
                ? 'PAUSED'
                : isEvaluating
                ? 'AI SCAN'
                : connection_status === 'connected'
                ? 'LIVE'
                : 'SYNCING'}
            </Text>
          </BlurView>

          {/* Flashlight Indicator Badge (if on) */}
          {isTorchOn && (
            <BlurView intensity={80} tint="dark" style={styles.torchIndicatorBadge}>
              <Ionicons name="flashlight" size={14} color="#facc15" />
            </BlurView>
          )}

          {/* Exit Button */}
          <TouchableOpacity
            style={styles.exitButton}
            onPress={handleExit}
            activeOpacity={0.7}
          >
            <BlurView intensity={80} tint="dark" style={styles.exitButtonBlur}>
              <Ionicons name="close" size={20} color="#f87171" />
            </BlurView>
          </TouchableOpacity>
        </View>

        {/* Network Reconnection / Slow Connection Toast */}
        {networkToast && (
          <View style={styles.toastWrapper}>
            <BlurView intensity={90} tint="dark" style={styles.toastBlur}>
              <ActivityIndicator size="small" color="#f59e0b" style={{ marginRight: 8 }} />
              <Text style={styles.toastText}>{networkToast}</Text>
            </BlurView>
          </View>
        )}
      </SafeAreaView>

      {/* 3. Middle Section (Clear Viewfinder - Kept completely clear) */}
      <View style={styles.middleClearZone} pointerEvents="none">
        {/* Subtle Viewfinder Corner Guides */}
        <View style={styles.reticleContainer}>
          <View style={[styles.reticleCorner, styles.reticleTopLeft, isHazardMode && styles.reticleHazard]} />
          <View style={[styles.reticleCorner, styles.reticleTopRight, isHazardMode && styles.reticleHazard]} />
          <View style={[styles.reticleCorner, styles.reticleBottomLeft, isHazardMode && styles.reticleHazard]} />
          <View style={[styles.reticleCorner, styles.reticleBottomRight, isHazardMode && styles.reticleHazard]} />
        </View>
      </View>

      {/* Success Badge Banner */}
      {showSuccessBadge && (
        <View style={styles.successBadgeContainer} pointerEvents="none">
          <BlurView intensity={90} tint="dark" style={styles.successBadgeBlur}>
            <Ionicons name="checkmark-circle" size={22} color="#22c55e" style={{ marginRight: 8 }} />
            <Text style={styles.successBadgeText}>Step Verified & Complete!</Text>
          </BlurView>
        </View>
      )}

      {/* 4. Bottom Section (Thumb Zone - Instructions & Floating Actions) */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}>
        {/* Large Glassmorphism HUD Card */}
        <BlurView
          intensity={95}
          tint={isHazardMode ? 'dark' : 'dark'}
          style={[
            styles.bottomCard,
            isHazardMode && styles.bottomCardHazard,
          ]}
        >
          {/* Card Header Tag Row */}
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.stepTag,
                isHazardMode && styles.stepTagHazard,
              ]}
            >
              <Text style={[styles.stepTagText, isHazardMode && styles.stepTagTextHazard]}>
                {isHazardMode ? '⚠️ SAFETY HAZARD' : `TARGET STEP #${active_step_number}`}
              </Text>
            </View>

            {isEvaluating && !isHazardMode && (
              <View style={styles.analyzingIndicator}>
                <ActivityIndicator size="small" color="#38bdf8" style={{ marginRight: 6 }} />
                <Text style={styles.analyzingText}>Analyzing Target...</Text>
              </View>
            )}
          </View>

          {/* Main Large Instruction Text */}
          <Text
            style={[
              styles.instructionText,
              isHazardMode && styles.instructionTextHazard,
            ]}
            numberOfLines={3}
          >
            {isHazardMode
              ? hazardMessage || 'HAZARD DETECTED! STOP WORK IMMEDIATELY.'
              : currentStepText || currentStep?.instruction || 'Point camera at equipment.'}
          </Text>

          {/* Hinglish Spoken AI Feedback Pill */}
          {!isHazardMode && latestFeedback ? (
            <View style={styles.feedbackPill}>
              <Ionicons name="volume-medium-outline" size={16} color="#38bdf8" style={{ marginRight: 6 }} />
              <Text style={styles.feedbackText} numberOfLines={2}>
                "{latestFeedback}"
              </Text>
            </View>
          ) : null}

          {/* Hazard Clear CTA Button (In Hazard Mode) */}
          {isHazardMode && (
            <TouchableOpacity
              style={styles.hazardDismissBtn}
              onPress={handleDismissHazard}
              activeOpacity={0.8}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.hazardDismissBtnText}>Clear Hazard & Resume</Text>
            </TouchableOpacity>
          )}

          {/* Floating Circular Action Button Controls (Thumb Zone) */}
          {!isHazardMode && (
            <View style={styles.actionControlsRow}>
              {/* Flashlight Toggle */}
              <TouchableOpacity
                style={[
                  styles.circleActionBtn,
                  isTorchOn && styles.circleActionBtnActive,
                ]}
                onPress={toggleFlashlight}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isTorchOn ? 'flashlight' : 'flashlight-outline'}
                  size={22}
                  color={isTorchOn ? '#facc15' : '#e2e8f0'}
                />
              </TouchableOpacity>

              {/* Undo / Prev Step */}
              <TouchableOpacity
                style={[
                  styles.circleActionBtn,
                  active_step_number <= 1 && styles.circleActionBtnDisabled,
                ]}
                onPress={handleUndoStep}
                disabled={active_step_number <= 1}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={active_step_number <= 1 ? '#475569' : '#e2e8f0'}
                />
              </TouchableOpacity>

              {/* Pause / Resume AI */}
              <TouchableOpacity
                style={[
                  styles.circleActionBtn,
                  isPaused ? styles.circleActionBtnResume : styles.circleActionBtnPause,
                ]}
                onPress={togglePauseAI}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isPaused ? 'play' : 'pause'}
                  size={24}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              {/* Force Skip Step */}
              <TouchableOpacity
                style={styles.circleActionBtn}
                onPress={handleForceSkip}
                activeOpacity={0.7}
              >
                <Ionicons name="play-skip-forward" size={22} color="#38bdf8" />
              </TouchableOpacity>
            </View>
          )}
        </BlurView>
      </SafeAreaView>

      {/* Paused Loop Modal Overlay */}
      {isPaused && !isHazardMode && (
        <View style={styles.pausedOverlay}>
          <BlurView intensity={95} tint="dark" style={styles.pausedModalCard}>
            <View style={styles.pausedIconRing}>
              <Ionicons name="pause" size={32} color="#f59e0b" />
            </View>
            <Text style={styles.pausedTitle}>Inspection Paused</Text>
            <Text style={styles.pausedDescription}>
              {pauseReason || 'Camera loop paused to save API costs. Point at the equipment and resume.'}
            </Text>
            <TouchableOpacity
              style={styles.resumePrimaryBtn}
              onPress={handleResumeCamera}
              activeOpacity={0.8}
            >
              <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.resumePrimaryBtnText}>Resume Camera</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
  rootContainerHazard: {
    borderColor: '#ef4444',
    borderWidth: 3,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  permissionIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  permissionSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
    shadowColor: '#0284c7',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  topSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  progressBarTrack: {
    width: '100%',
    height: 3.5,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  progressBarFillHazard: {
    backgroundColor: '#ef4444',
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  stepCounterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  stepCounterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  pillDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 8,
  },
  connectionStatusText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.8,
  },
  torchIndicatorBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.4)',
  },
  exitButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  exitButtonBlur: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
  },
  toastWrapper: {
    alignItems: 'center',
    paddingTop: 8,
  },
  toastBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  toastText: {
    color: '#fef3c7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  middleClearZone: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleContainer: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  reticleCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  reticleHazard: {
    borderColor: '#ef4444',
  },
  reticleTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 6,
  },
  reticleTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 6,
  },
  reticleBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 6,
  },
  reticleBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 6,
  },
  successBadgeContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 40,
  },
  successBadgeBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.6)',
    backgroundColor: 'rgba(20, 83, 45, 0.45)',
  },
  successBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottomSafeArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 30,
  },
  bottomCard: {
    borderRadius: 28,
    padding: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  bottomCardHazard: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(127, 29, 29, 0.75)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepTag: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  stepTagHazard: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  stepTagText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  stepTagTextHazard: {
    color: '#fca5a5',
  },
  analyzingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  analyzingText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 28,
    letterSpacing: 0.2,
    marginBottom: 12,
  },
  instructionTextHazard: {
    color: '#fee2e2',
  },
  feedbackPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  feedbackText: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  hazardDismissBtn: {
    backgroundColor: '#dc2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f87171',
    marginTop: 6,
    shadowColor: '#dc2626',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  hazardDismissBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  actionControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  circleActionBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  circleActionBtnActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    borderColor: 'rgba(250, 204, 21, 0.5)',
  },
  circleActionBtnDisabled: {
    opacity: 0.4,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  circleActionBtnPause: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  circleActionBtnResume: {
    backgroundColor: '#d97706',
    borderColor: '#fbbf24',
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 50,
  },
  pausedModalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  pausedIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  pausedTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  pausedDescription: {
    color: '#cbd5e1',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  resumePrimaryBtn: {
    backgroundColor: '#0284c7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#38bdf8',
    width: '100%',
    shadowColor: '#0284c7',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  resumePrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
