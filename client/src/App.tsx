import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useEffect } from 'react';
import { RulesSheet } from './components/Rules';
import { Toasts } from './components/Ui';
import { getUrlCode, wakeServer } from './net';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { useStore } from './store';

export default function App() {
  const state = useStore((s) => s.state);
  const connected = useStore((s) => s.connected);
  const session = useStore((s) => s.session);

  useEffect(() => {
    const code = getUrlCode();
    if (code) useStore.getState().setInviteCode(code);
    void wakeServer();
  }, []);

  const screen = !state ? 'home' : state.phase === 'lobby' ? 'lobby' : 'table';

  return (
    <div className="app">
      <div className="bg-deco" aria-hidden />
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          className="screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {screen === 'home' && <Home />}
          {screen === 'lobby' && state && <Lobby state={state} />}
          {screen === 'table' && state && <Table state={state} />}
        </motion.div>
      </AnimatePresence>
      {state && !connected && session && (
        <div className="conn-banner" role="alert">
          <WifiOff size={16} /> Connexion perdue… reconnexion en cours
        </div>
      )}
      <RulesSheet />
      <Toasts />
    </div>
  );
}
