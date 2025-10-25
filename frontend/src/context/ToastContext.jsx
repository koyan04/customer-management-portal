import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Toast from '../components/Toast.jsx';

const ToastContext = createContext({ show: () => {} });

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ open: false, variant: 'success', title: '', message: '' });

  const show = useCallback((opts) => {
    const { title = '', message = '', variant = 'success', duration } = opts || {};
    setToast({ open: true, title, message, variant, duration });
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast
        open={toast.open}
        variant={toast.variant}
        title={toast.title}
        message={toast.message}
        duration={toast.duration}
        onClose={() => setToast(t => ({ ...t, open: false }))}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export default ToastContext;
