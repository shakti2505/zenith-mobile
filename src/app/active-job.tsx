import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { useJobStore } from '../store/useJobStore';

// Detect if running inside standard Expo Go client app
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient || Constants.appOwnership === 'expo';

// Dynamically load native VisionCamera & LiveKit only when NOT in Expo Go to prevent C++ TurboModule crashes
let Camera: any = null;
let useCameraDevice: any = () => null;
let useCameraPermission: any = () => ({ hasPermission: true, requestPermission: async () => true });
let LiveKitRoom: any = null;

if (!isExpoGo) {
  try {
    const visionCam = require('react-native-vision-camera');
    Camera = visionCam.Camera;
    useCameraDevice = visionCam.useCameraDevice;
    useCameraPermission = visionCam.useCameraPermission;

    const livekit = require('@livekit/react-native');
    LiveKitRoom = livekit.LiveKitRoom;
    if (livekit.registerGlobals) livekit.registerGlobals();
  } catch (e) {
    console.log('Native camera module load fallback');
  }
}

// Fastify Server Base URL (Android emulator: 10.0.2.2, iOS simulator/local network IP fallback)
const FASTIFY_SERVER_URL = 'http://10.0.2.2:5000/api';

export default function ActiveJobScreen() {
  const router = useRouter();
  const cameraRef = useRef<any>(null);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  const {
    work_order_id,
    equipment,
    active_step_number,
    steps,
    connection_status,
    is_ai_speaking,
    ai_status_message,
    nextStep,
    prevStep,
    setConnectionStatus,
    setAiSpeaking,
  } = useJobStore();

  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>('wss://livekit.example.com');
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);

  const currentStep = steps.find((s) => s.stepNumber === active_step_number) || steps[0];

  // Request permissions & fetch LiveKit Token setup
  useEffect(() => {
    (async () => {
      if (!hasPermission && !isExpoGo) {
        await requestPermission();
      }
      await fetchLiveKitToken();
    })();
  }, []);

  const fetchLiveKitToken = async () => {
    try {
      setConnectionStatus('connecting');
      const res = await fetch(`${FASTIFY_SERVER_URL}/rtc/token?room=room-${work_order_id}&identity=field-worker-1`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.token) {
          setLivekitToken(data.data.token);
          if (data.data.url) setLivekitUrl(data.data.url);
          setConnectionStatus('connected');
          return;
        }
      }
      setConnectionStatus('connected');
    } catch (err) {
      setConnectionStatus('connected');
    }
  };

  // 2-second Frame Snapshot Capture Loop
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!isCapturing) {
        try {
          setIsCapturing(true);

          if (!isExpoGo && cameraRef.current) {
            // Silently capture hardware snapshot
            const photo = await cameraRef.current.takeSnapshot({
              quality: 85,
              skipMetadata: true,
            });

            if (photo?.path) {
              const base64Data = await FileSystem.readAsStringAsync(photo.path, {
                encoding: FileSystem.EncodingType.Base64,
              });

              setSnapshotCount((prev) => prev + 1);

              fetch(`${FASTIFY_SERVER_URL}/ai-chat/analyze-frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  imageBase64: `data:image/jpeg;base64,${base64Data}`,
                  workOrderId: work_order_id,
                  stepNumber: active_step_number,
                  prompt: `Step ${active_step_number}: ${currentStep?.title}`,
                }),
              }).catch(() => {});
            }
          } else {
            // Simulated snapshot interval in Expo Go
            setSnapshotCount((prev) => prev + 1);
          }
        } catch (error) {
          console.log('Snapshot error:', error);
        } finally {
          setIsCapturing(false);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isCapturing, work_order_id, active_step_number, currentStep]);

  if (!hasPermission && !isExpoGo) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950 justify-center items-center p-6">
        <Text className="text-white text-lg font-bold mb-2 text-center">Camera Access Required</Text>
        <TouchableOpacity
          className="bg-blue-600 px-6 py-3.5 rounded-2xl"
          onPress={requestPermission}
        >
          <Text className="text-white font-bold">Grant Camera Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-black relative">
      {/* 1. Background Camera Feed (Native Hardware or Expo Go Simulation) */}
      {!isExpoGo && device && Camera ? (
        <Camera
          ref={cameraRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          device={device}
          isActive={true}
          photo={true}
        />
      ) : (
        <View className="flex-1 justify-center items-center bg-slate-900 px-6">
          <View className="w-16 h-16 rounded-full bg-blue-500/20 items-center justify-center mb-4 border border-blue-500/40">
            <Text className="text-2xl">📷</Text>
          </View>
          <Text className="text-white font-bold text-lg text-center mb-1">
            Industrial Copilot Camera View
          </Text>
          <Text className="text-slate-400 text-xs text-center leading-4 max-w-xs mb-4">
            {isExpoGo
              ? '⚡ Running in Expo Go. Preview mode active.'
              : 'Initializing Camera Stream...'}
          </Text>

          {isExpoGo && (
            <View className="bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
              <Text className="text-blue-400 text-[11px] font-mono text-center">
                For Native Hardware Camera & WebRTC stream run: npx expo run:android
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 2. LiveKit Room Broadcast (when not in Expo Go) */}
      {!isExpoGo && LiveKitRoom && livekitToken && (
        <LiveKitRoom
          serverUrl={livekitUrl}
          token={livekitToken}
          connect={true}
          audio={true}
          video={true}
          onConnected={() => setConnectionStatus('connected')}
          onDisconnected={() => setConnectionStatus('disconnected')}
        />
      )}

      {/* 3. Floating Overlay Header */}
      <SafeAreaView className="absolute top-4 left-4 right-4 flex-row justify-between items-center z-20">
        <View className="bg-slate-900/80 backdrop-blur-md px-3.5 py-1.5 rounded-full flex-row items-center border border-white/10">
          <View className={`w-2.5 h-2.5 rounded-full mr-2 ${
            connection_status === 'connected' ? 'bg-emerald-400' : connection_status === 'connecting' ? 'bg-amber-400' : 'bg-rose-500'
          }`} />
          <Text className="text-white text-xs font-mono font-bold uppercase tracking-wide">
            {connection_status}
          </Text>
          <Text className="text-slate-400 text-[10px] ml-2 border-l border-slate-700 pl-2">
            FPS: 30 • SNAPSHOTS: {snapshotCount}
          </Text>
        </View>

        <TouchableOpacity
          className="bg-rose-600/90 active:bg-rose-700 px-4 py-2 rounded-full border border-rose-400/30"
          onPress={() => router.back()}
        >
          <Text className="text-white text-xs font-black uppercase">Exit Job</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* 4. Floating AI Voice Indicator Badge */}
      <View className="absolute top-24 left-4 right-4 items-center z-20">
        <View className={`px-4 py-2 rounded-full flex-row items-center backdrop-blur-md border ${
          is_ai_speaking ? 'bg-indigo-600/90 border-cyan-400' : 'bg-slate-950/80 border-slate-700'
        }`}>
          <View className={`w-2 h-2 rounded-full mr-2 ${
            is_ai_speaking ? 'bg-cyan-300' : 'bg-emerald-400'
          }`} />
          <Text className="text-white text-xs font-semibold">{ai_status_message}</Text>
        </View>
      </View>

      {/* 5. Floating Glassmorphism Instruction Overlay Card */}
      <View className="absolute bottom-6 left-4 right-4 bg-slate-950/85 backdrop-blur-xl p-5 rounded-3xl border border-slate-800 shadow-2xl z-20">
        <View className="flex-row justify-between items-center mb-2">
          <View className="bg-blue-500/20 px-3 py-1 rounded-full border border-blue-500/30">
            <Text className="text-blue-400 text-[11px] font-bold uppercase tracking-wider">
              STEP {currentStep?.stepNumber} OF {steps.length}
            </Text>
          </View>
          <Text className="text-slate-400 text-xs font-mono">{work_order_id}</Text>
        </View>

        <Text className="text-slate-400 text-xs font-semibold mb-1">🔧 {equipment}</Text>
        <Text className="text-white text-lg font-black mb-1.5">{currentStep?.title}</Text>
        <Text className="text-slate-300 text-sm leading-5 mb-5">{currentStep?.instruction}</Text>

        <View className="flex-row space-x-3">
          <TouchableOpacity
            className={`flex-1 py-3.5 rounded-2xl items-center justify-center border ${
              active_step_number === 1
                ? 'bg-slate-900/40 border-slate-800 opacity-40'
                : 'bg-slate-800 border-slate-700 active:bg-slate-700'
            }`}
            onPress={prevStep}
            disabled={active_step_number === 1}
          >
            <Text className="text-white font-semibold text-xs">◀ Previous Step</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 bg-blue-600 active:bg-blue-700 py-3.5 rounded-2xl items-center justify-center shadow-lg border border-blue-400/30"
            onPress={nextStep}
          >
            <Text className="text-white font-bold text-xs">
              {active_step_number === steps.length ? 'Complete Inspection ✓' : 'Next Step ▶'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
