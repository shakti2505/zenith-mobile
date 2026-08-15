import React from 'react';
import { View, Text, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { useJobStore, WorkOrder } from '../store/useJobStore';

export default function JobListScreen() {
  const router = useRouter();
  const { availableJobs, setActiveJob, work_order_id } = useJobStore();

  const handleSelectJob = (job: WorkOrder) => {
    setActiveJob(job);
    router.push('/active-job');
  };

  const renderJobCard = ({ item }: { item: WorkOrder }) => {
    const isCurrentActive = work_order_id === item.id;

    return (
      <View className={`mb-4 p-5 rounded-2xl border ${
        isCurrentActive ? 'bg-slate-800 border-blue-500/60 shadow-lg' : 'bg-slate-900 border-slate-800'
      }`}>
        {/* Top Header: ID & Priority */}
        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-row items-center space-x-2">
            <View className="bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">
              <Text className="text-blue-400 font-mono text-xs font-bold">{item.id}</Text>
            </View>
            {isCurrentActive && (
              <View className="bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30 flex-row items-center">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
                <Text className="text-emerald-400 text-[10px] font-bold uppercase">ACTIVE</Text>
              </View>
            )}
          </View>
          <View className={`px-2.5 py-1 rounded-full ${
            item.priority === 'HIGH' ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-slate-700'
          }`}>
            <Text className={`text-[10px] font-bold ${
              item.priority === 'HIGH' ? 'text-amber-400' : 'text-slate-300'
            }`}>{item.priority} PRIORITY</Text>
          </View>
        </View>

        {/* Title & Equipment */}
        <Text className="text-white text-lg font-bold mb-1">{item.title}</Text>
        <Text className="text-slate-400 text-xs mb-4">
          🔧 {item.equipment}  •  📍 {item.location}
        </Text>

        {/* Steps info & Launch Button */}
        <View className="flex-row justify-between items-center pt-3 border-t border-slate-800">
          <Text className="text-slate-400 text-xs">
            📋 <Text className="text-slate-200 font-semibold">{item.steps.length} Inspection Steps</Text>
          </Text>

          <TouchableOpacity
            className="bg-blue-600 px-4 py-2.5 rounded-xl flex-row items-center space-x-1.5 active:bg-blue-700"
            onPress={() => handleSelectJob(item)}
          >
            <Text className="text-white font-bold text-xs">Launch AI Copilot ➔</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="px-5 pt-4 pb-2">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Field Operations Dashboard</Text>
        <Text className="text-white text-2xl font-black mb-4">Select Assigned Work Order</Text>
      </View>

      <FlatList
        data={availableJobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobCard}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}
