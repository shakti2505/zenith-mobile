import { create } from 'zustand';
import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export interface Step {
  stepNumber: number;
  title: string;
  instruction: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface WorkOrder {
  id: string;
  title: string;
  equipment: string;
  location: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assetId?: string;
  steps: Step[];
}

export interface ProcedureDocument {
  documentTitle: string;
  section?: string;
  content: string;
  assetId: string;
  tags?: string[];
}

interface JobState {
  work_order_id: string | null;
  work_order_title: string;
  equipment: string;
  assetId: string | null;
  active_step_number: number;
  steps: Step[];
  procedure: ProcedureDocument | null;
  connection_status: 'disconnected' | 'connecting' | 'connected' | 'error';
  is_ai_speaking: boolean;
  ai_status_message: string;
  availableJobs: WorkOrder[];
  isLoadingJobs: boolean;
  jobFetchError: string | null;

  // Actions
  fetchAvailableJobs: () => Promise<void>;
  fetchProcedureForAsset: (assetId: string) => Promise<void>;
  setActiveJob: (job: WorkOrder) => void;
  setStepNumber: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setConnectionStatus: (status: JobState['connection_status']) => void;
  setAiSpeaking: (speaking: boolean, message?: string) => void;
  resetJob: () => void;
}

// Server URL helper
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

export const useJobStore = create<JobState>((set, get) => ({
  work_order_id: null,
  work_order_title: '',
  equipment: '',
  assetId: null,
  active_step_number: 1,
  steps: [],
  procedure: null,
  connection_status: 'disconnected',
  is_ai_speaking: false,
  ai_status_message: 'AI Copilot Ready',
  availableJobs: [],
  isLoadingJobs: false,
  jobFetchError: null,

  // Fetch Procedures & Work Orders from MongoDB via Fastify API
  fetchAvailableJobs: async () => {
    try {
      set({ isLoadingJobs: true, jobFetchError: null });
      console.log(`[JobStore] Fetching procedures & work orders from ${FASTIFY_SERVER_URL}`);

      const allJobs: WorkOrder[] = [];

      // 1. Fetch Standard & Custom Procedures from MongoDB
      try {
        const procResponse = await axios.get(`${FASTIFY_SERVER_URL}/procedures`, { timeout: 8000 });
        const procedures = procResponse.data?.data || [];

        if (Array.isArray(procedures)) {
          procedures.forEach((proc: any, idx: number) => {
            const mappedSteps: Step[] = (proc.steps || []).map((st: any) => ({
              stepNumber: st.step_number,
              title: `Step ${st.step_number}`,
              instruction: st.instruction_text + (st.safety_warning ? ` (⚠️ ${st.safety_warning})` : ''),
              status: st.step_number === 1 ? ('IN_PROGRESS' as const) : ('PENDING' as const),
            }));

            allJobs.push({
              id: proc._id,
              title: proc.title,
              equipment: proc.is_custom ? 'Custom Digitized SOP' : 'Domestic RO Purifier',
              location: 'Plant Workcell A',
              priority: proc.is_custom ? 'HIGH' : 'CRITICAL',
              assetId: proc.is_custom ? 'CUSTOM-SOP' : 'RO-SYS-01',
              steps: mappedSteps.length > 0 ? mappedSteps : [
                {
                  stepNumber: 1,
                  title: 'Initial Visual Inspection',
                  instruction: 'Inspect unit for visible damage, leakages, or anomalies.',
                  status: 'IN_PROGRESS',
                },
              ],
            });
          });
        }
      } catch (procErr: any) {
        console.warn('[JobStore] Notice loading procedures:', procErr.message);
      }

      // 2. Fetch Work Orders from MongoDB
      try {
        const woResponse = await axios.get(`${FASTIFY_SERVER_URL}/work-orders`, { timeout: 8000 });
        const rawOrders = woResponse.data?.data || [];

        if (Array.isArray(rawOrders)) {
          rawOrders.forEach((item: any, idx: number) => {
            const mappedSteps: Step[] = (item.steps || []).map((st: any, sIdx: number) => ({
              stepNumber: sIdx + 1,
              title: st.title || `Step ${sIdx + 1}`,
              instruction: st.description || st.title || 'Proceed with standard procedure inspection.',
              status: st.completed ? 'COMPLETED' : sIdx === item.currentStepIndex ? 'IN_PROGRESS' : 'PENDING',
            }));

            allJobs.push({
              id: item._id || `WO-${idx + 1}`,
              title: item.title,
              equipment: item.assetId || 'Unit Equipment',
              location: item.assignedWorkerName || 'Facility Alpha',
              priority: (item.priority ? item.priority.toUpperCase() : 'MEDIUM') as any,
              assetId: item.assetId,
              steps: mappedSteps.length > 0 ? mappedSteps : [
                {
                  stepNumber: 1,
                  title: 'Initial Visual Inspection',
                  instruction: 'Inspect unit for visible damage, leakages, or structural anomalies.',
                  status: 'IN_PROGRESS',
                },
              ],
            });
          });
        }
      } catch (woErr: any) {
        console.warn('[JobStore] Notice loading work orders:', woErr.message);
      }

      set({ availableJobs: allJobs, isLoadingJobs: false });

      // Auto-select first job if none selected
      if (!get().work_order_id && allJobs.length > 0) {
        get().setActiveJob(allJobs[0]);
      }
    } catch (err: any) {
      const errMsg = axios.isAxiosError(err)
        ? `API Error (${err.response?.status || err.code}): ${err.message}`
        : err.message || 'Unknown network error';
      console.error('[JobStore] Failed to fetch tasks:', errMsg);
      set({ jobFetchError: errMsg, isLoadingJobs: false });
    }
  },

  // Fetch SOP Procedure from MongoDB Knowledge module for the active asset
  fetchProcedureForAsset: async (assetId: string) => {
    if (!assetId) return;
    try {
      console.log(`[JobStore] Fetching SOP procedure from ${FASTIFY_SERVER_URL}/knowledge/asset/${assetId}`);
      const response = await axios.get(`${FASTIFY_SERVER_URL}/knowledge/asset/${assetId}`, {
        timeout: 8000,
      });

      const chunks = response.data?.data || [];
      if (Array.isArray(chunks) && chunks.length > 0) {
        const firstChunk = chunks[0];
        set({
          procedure: {
            documentTitle: firstChunk.metadata?.documentTitle || 'Standard Operating Procedure',
            section: firstChunk.metadata?.section || 'Inspection Protocol',
            content: firstChunk.content,
            assetId: firstChunk.assetId,
            tags: firstChunk.metadata?.tags || [],
          },
        });
        console.log(`[JobStore] Loaded procedure: "${firstChunk.metadata?.documentTitle}"`);
      }
    } catch (err) {
      console.warn('[JobStore] Could not fetch procedure for asset:', assetId, err);
    }
  },

  setActiveJob: (job) => {
    set({
      work_order_id: job.id,
      work_order_title: job.title,
      equipment: job.equipment,
      assetId: job.assetId || null,
      steps: job.steps,
      active_step_number: 1,
    });
    if (job.assetId) {
      get().fetchProcedureForAsset(job.assetId);
    }
  },

  setStepNumber: (step) => set({ active_step_number: step }),

  nextStep: () => {
    const { active_step_number, steps } = get();
    if (active_step_number < steps.length) {
      set({ active_step_number: active_step_number + 1 });
    }
  },

  prevStep: () => {
    const { active_step_number } = get();
    if (active_step_number > 1) {
      set({ active_step_number: active_step_number - 1 });
    }
  },

  setConnectionStatus: (status) => set({ connection_status: status }),

  setAiSpeaking: (speaking, message) =>
    set({
      is_ai_speaking: speaking,
      ai_status_message:
        message || (speaking ? 'AI Copilot Analyzing Stream...' : 'AI Copilot Listening...'),
    }),

  resetJob: () =>
    set({
      work_order_id: null,
      work_order_title: '',
      equipment: '',
      assetId: null,
      active_step_number: 1,
      steps: [],
      procedure: null,
      connection_status: 'disconnected',
      is_ai_speaking: false,
      ai_status_message: 'Offline',
    }),
}));
