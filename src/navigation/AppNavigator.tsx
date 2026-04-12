import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import LoginScreen from '../screens/LoginScreen';
import WorkspacesScreen from '../screens/WorkspacesScreen';
import JobsListScreen from '../screens/JobsListScreen';
import JobDetailsScreen from '../screens/JobDetailsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerStyle: { backgroundColor: '#0078D4' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: 'AML Monitor', headerShown: false }}
        />
        <Stack.Screen
          name="Workspaces"
          component={WorkspacesScreen}
          options={{ title: 'Workspaces', headerLeft: () => null }}
        />
        <Stack.Screen
          name="Jobs"
          component={JobsListScreen}
          options={({ route }) => ({ title: route.params.workspaceName })}
        />
        <Stack.Screen
          name="JobDetails"
          component={JobDetailsScreen}
          options={{ title: 'Job Details' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
