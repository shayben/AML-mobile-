# AML Mobile

A React Native (Expo) mobile application for monitoring Azure Machine Learning training jobs from your phone or tablet.

## Features

- 🔑 **Service Principal Authentication** — Securely connect using an Azure service principal (Tenant ID, Client ID, Client Secret, Subscription ID).
- 🗂️ **Workspace Browser** — List all AML workspaces in your Azure subscription and select one to explore.
- 📋 **Jobs List** — View all training runs across experiments with status filters (All / Running / Completed / Failed / Canceled).
- 📊 **Live Metrics** — See real-time metric charts (loss, accuracy, and any custom metrics) for training jobs, with auto-refresh every 15 seconds for running jobs.
- ℹ️ **Job Details** — Full job information including duration, tags, properties, and a cancel button for running jobs.
- 🔄 **Pull-to-Refresh** — Refresh any screen manually with a swipe gesture.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- An Azure subscription with at least one Azure Machine Learning workspace
- A service principal with the **Reader** role (or **AzureML Data Scientist**) on the workspace

### Install Dependencies

```bash
npm install
```

### Run

```bash
# Start the Expo development server
npm start

# Open on Android
npm run android

# Open on iOS (macOS only)
npm run ios
```

### Run Tests

```bash
npm test
```

## Project Structure

```
├── App.tsx                    # App entry point
├── src/
│   ├── constants/             # API URLs, storage keys, colour maps
│   ├── navigation/            # React Navigation stack
│   ├── screens/
│   │   ├── LoginScreen.tsx    # Service principal credentials form
│   │   ├── WorkspacesScreen.tsx  # Workspace list
│   │   ├── JobsListScreen.tsx    # Training runs list with filters
│   │   └── JobDetailsScreen.tsx  # Run details + metric charts
│   ├── components/
│   │   ├── JobCard.tsx        # Run list item
│   │   ├── MetricChart.tsx    # Line chart for a single metric series
│   │   ├── LoadingSpinner.tsx # Loading state
│   │   └── ErrorMessage.tsx   # Error state with retry
│   ├── services/
│   │   ├── azureMLService.ts  # Azure ML REST API client
│   │   └── storageService.ts  # AsyncStorage helpers
│   └── types/                 # TypeScript type definitions
└── assets/                    # App icons and splash screen
```

## Authentication

The app uses the Azure AD **client credentials flow**. Create a service principal:

```bash
az ad sp create-for-rbac --name "aml-mobile-app" --role Reader \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RG>/providers/Microsoft.MachineLearningServices/workspaces/<WORKSPACE>
```

You will receive the `tenantId`, `clientId`, and `clientSecret` needed on the login screen.
