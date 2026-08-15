import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import '../global.css';

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0F172A',
          },
          headerTintColor: '#F8FAFC',
          headerTitleStyle: {
            fontWeight: '700',
          },
          contentStyle: {
            backgroundColor: '#0F172A',
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Active Work Orders',
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen
          name="active-job"
          options={{
            title: 'Live Industrial Copilot',
            headerShown: false, // Fullscreen camera view with floating UI
            presentation: 'fullScreenModal',
          }}
        />
      </Stack>
    </View>
  );
}
