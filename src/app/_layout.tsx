import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../global.css';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#09090B',
          },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontWeight: '800',
          },
          contentStyle: {
            backgroundColor: '#09090B',
          },
          headerShown: false,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Work Orders',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="work-order-details"
          options={{
            title: 'Work Order Details',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="upload-sop"
          options={{
            title: 'Generate Dynamic SOP',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="active-job"
          options={{
            title: 'Live Industrial Copilot',
            headerShown: false,
            presentation: 'fullScreenModal',
          }}
        />
      </Stack>
    </>
  );
}
