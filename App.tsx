import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectOptions } from './src/native/SshModule';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';

type Params = Omit<ConnectOptions, 'cols' | 'rows'>;

export default function App() {
  const [params, setParams] = useState<Params | null>(null);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {params ? (
        <TerminalScreen params={params} onClose={() => setParams(null)} />
      ) : (
        <ConnectScreen onConnect={setParams} />
      )}
    </SafeAreaProvider>
  );
}
