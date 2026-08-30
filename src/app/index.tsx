import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useJobStore, WorkOrder } from '../store/useJobStore';

export default function WorkOrderListScreen() {
  const router = useRouter();
  const {
    availableJobs,
    setActiveJob,
    work_order_id,
    isLoadingJobs,
    jobFetchError,
    fetchAvailableJobs,
  } = useJobStore();

  useEffect(() => {
    fetchAvailableJobs();
  }, []);

  const handleSelectJob = (job: WorkOrder) => {
    setActiveJob(job);
    router.push({
      pathname: '/work-order-details',
      params: { procedure_id: job.id },
    });
  };

  const renderJobCard = ({ item }: { item: WorkOrder }) => {
    const isCurrentActive = work_order_id === item.id;
    const completedSteps = item.steps.filter((s) => s.status === 'COMPLETED').length;
    const totalSteps = item.steps.length || 1;
    const progressPercent = Math.round((completedSteps / totalSteps) * 100);

    return (
      <TouchableOpacity
        style={[styles.cardTouchable, isCurrentActive && styles.cardActive]}
        onPress={() => handleSelectJob(item)}
        activeOpacity={0.75}
      >
        <BlurView intensity={80} tint="dark" style={styles.cardBlur}>
          <View style={styles.cardRow}>
            {/* Left Icon */}
            <View style={[styles.iconContainer, isCurrentActive && styles.iconContainerActive]}>
              <Feather
                name={isCurrentActive ? 'activity' : 'clipboard'}
                size={24}
                color={isCurrentActive ? '#10B981' : '#FFFFFF'}
              />
            </View>

            {/* Middle Content */}
            <View style={styles.cardContent}>
              <View style={styles.cardMetaRow}>
                <Text style={styles.assetTag}>
                  {item.assetId || item.id.slice(-8).toUpperCase()}
                </Text>
                {item.priority === 'CRITICAL' && (
                  <View style={styles.priorityBadge}>
                    <Text style={styles.priorityText}>CRITICAL</Text>
                  </View>
                )}
              </View>

              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.location ? `${item.location} • ` : ''}
                {item.steps.length} {item.steps.length === 1 ? 'Step' : 'Steps'}
                {completedSteps > 0 ? ` (${progressPercent}% done)` : ''}
              </Text>

              {/* Progress Track */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%`,
                      backgroundColor: isCurrentActive ? '#10B981' : '#38BDF8',
                    },
                  ]}
                />
              </View>
            </View>

            {/* Right Chevron */}
            <View style={styles.chevronContainer}>
              <Feather name="chevron-right" size={24} color="#10B981" />
            </View>
          </View>
        </BlurView>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.headerBadgeText}>ZENITH COPILOT HUD</Text>
        </View>
        <Text style={styles.headerTitle}>Work Orders</Text>
        <Text style={styles.headerSubtitle}>
          Select an assigned task or scan a physical SOP to start live visual inspection.
        </Text>

        {/* Scan SOP Action Card */}
        <TouchableOpacity
          style={styles.scanCard}
          onPress={() => router.push('/upload-sop')}
          activeOpacity={0.8}
        >
          <BlurView intensity={85} tint="dark" style={styles.scanBlur}>
            <View style={styles.scanIconCircle}>
              <Feather name="camera" size={20} color="#10B981" />
            </View>
            <View style={styles.scanTextWrapper}>
              <Text style={styles.scanTitle}>Scan Physical SOP / Manual</Text>
              <Text style={styles.scanSubtitle}>AI extracts steps and voice instructions</Text>
            </View>
            <Feather name="arrow-right" size={20} color="#10B981" />
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* Sync Error Alert */}
      {jobFetchError && (
        <View style={styles.errorBanner}>
          <BlurView intensity={80} tint="dark" style={styles.errorBlur}>
            <Feather name="alert-triangle" size={18} color="#F59E0B" style={{ marginRight: 10 }} />
            <Text style={styles.errorText} numberOfLines={2}>{jobFetchError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchAvailableJobs}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      )}

      {/* List / Loading */}
      {isLoadingJobs && availableJobs.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading work orders...</Text>
        </View>
      ) : (
        <FlatList
          data={availableJobs}
          keyExtractor={(item) => item.id}
          renderItem={renderJobCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoadingJobs}
              onRefresh={fetchAvailableJobs}
              tintColor="#10B981"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="inbox" size={48} color="#475569" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>No Active Work Orders</Text>
              <Text style={styles.emptySubtitle}>
                Tap 'Scan Physical SOP / Manual' above to digitize a machinery manual.
              </Text>
            </View>
          }
        />
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    marginBottom: 10,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  headerBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  scanCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    shadowColor: '#10B981',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  scanBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
  },
  scanIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  scanTextWrapper: {
    flex: 1,
  },
  scanTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  scanSubtitle: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '500',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  errorBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  errorText: {
    color: '#FEF3C7',
    fontSize: 12,
    flex: 1,
  },
  retryButton: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  cardTouchable: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardActive: {
    borderColor: 'rgba(16, 185, 129, 0.6)',
    shadowColor: '#10B981',
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  cardBlur: {
    padding: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  iconContainerActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  cardContent: {
    flex: 1,
    marginRight: 8,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  assetTag: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginRight: 8,
  },
  priorityBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  priorityText: {
    color: '#F87171',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  cardSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 8,
  },
  progressTrack: {
    width: '100%',
    height: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  chevronContainer: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 12,
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
});
