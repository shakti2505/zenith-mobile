import { create } from 'zustand';

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
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  steps: Step[];
}

interface JobState {
  work_order_id: string | null;
  work_order_title: string;
  equipment: string;
  active_step_number: number;
  steps: Step[];
  connection_status: 'disconnected' | 'connecting' | 'connected' | 'error';
  is_ai_speaking: boolean;
  ai_status_message: string;
  availableJobs: WorkOrder[];
  
  // Actions
  setActiveJob: (job: WorkOrder) => void;
  setStepNumber: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setConnectionStatus: (status: JobState['connection_status']) => void;
  setAiSpeaking: (speaking: boolean, message?: string) => void;
  resetJob: () => void;
}

export const INITIAL_JOBS: WorkOrder[] = [
  {
    id: 'WO-2026-8801',
    title: 'Turbine Pump Assembly Inspection',
    equipment: 'Centrifugal Pump Unit #3',
    location: 'Sector 4 - Hydro Plant',
    priority: 'HIGH',
    steps: [
      {
        stepNumber: 1,
        title: 'Inspect Pressure Valve Seal',
        instruction: 'Verify O-ring seating and inspect for hairline cracks, wear, or chemical degradation.',
        status: 'IN_PROGRESS',
      },
      {
        stepNumber: 2,
        title: 'Torque Main Flange Bolts',
        instruction: 'Tighten bolts in a cross-star pattern to specified 45 Nm using calibrated torque wrench.',
        status: 'PENDING',
      },
      {
        stepNumber: 3,
        title: 'Verify Fluid Flow Rate',
        instruction: 'Check digital manometer output and record initial static pressure baseline (min 3.2 bar).',
        status: 'PENDING',
      },
      {
        stepNumber: 4,
        title: 'Final Safety Clearance',
        instruction: 'Ensure lock-out tag-out mechanism is removed and sign digital clearance tag.',
        status: 'PENDING',
      },
    ],
  },
  {
    id: 'WO-2026-9402',
    title: 'Generator Stator Thermal Audit',
    equipment: 'Main Stator Housing B',
    location: 'Substation Alpha',
    priority: 'MEDIUM',
    steps: [
      {
        stepNumber: 1,
        title: 'Thermal Camera Alignment',
        instruction: 'Position thermal camera 1.5m from bearing casing and log initial ambient temp.',
        status: 'IN_PROGRESS',
      },
      {
        stepNumber: 2,
        title: 'Coolant Line Check',
        instruction: 'Inspect coolant return line valves for restrictions or thermal hotspots above 65°C.',
        status: 'PENDING',
      },
    ],
  },
];

export const useJobStore = create<JobState>((set, get) => ({
  work_order_id: INITIAL_JOBS[0].id,
  work_order_title: INITIAL_JOBS[0].title,
  equipment: INITIAL_JOBS[0].equipment,
  active_step_number: 1,
  steps: INITIAL_JOBS[0].steps,
  connection_status: 'disconnected',
  is_ai_speaking: false,
  ai_status_message: 'AI Copilot Ready',
  availableJobs: INITIAL_JOBS,

  setActiveJob: (job) => set({
    work_order_id: job.id,
    work_order_title: job.title,
    equipment: job.equipment,
    steps: job.steps,
    active_step_number: 1,
  }),

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

  setAiSpeaking: (speaking, message) => set({
    is_ai_speaking: speaking,
    ai_status_message: message || (speaking ? 'AI Copilot Analyzing Stream...' : 'AI Copilot Listening...'),
  }),

  resetJob: () => set({
    work_order_id: null,
    work_order_title: '',
    equipment: '',
    active_step_number: 1,
    steps: [],
    connection_status: 'disconnected',
    is_ai_speaking: false,
    ai_status_message: 'Offline',
  }),
}));
