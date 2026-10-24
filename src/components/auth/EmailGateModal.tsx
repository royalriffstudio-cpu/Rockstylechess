import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ConfirmModal } from '@/components/ui';
import { onEmailGate } from '@/lib/emailGate';
import { getSocket } from '@/lib/socket';

// "Verify your email to play online". Opened whenever the server refuses an online/social action because this is
// a new email/password account that has not entered its code yet: from a REST refusal (api.ts -> lib/emailGate.ts)
// or the socket's `account:gate` event. Mounted once in the root layout.
export function EmailGateModal() {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const open = () => setVisible(true);
    const off = onEmailGate(open);
    const socket = getSocket();
    socket.on('account:gate', open);
    return () => {
      off();
      socket.off('account:gate', open);
    };
  }, []);

  // Already on the code screen: the prompt would just sit on top of what it asks for.
  useEffect(() => {
    if (pathname === '/verify-email') setVisible(false);
  }, [pathname]);

  return (
    <ConfirmModal
      visible={visible}
      variant="neutral"
      icon="mail"
      title="Verify Your Email"
      message="Enter the 6-digit code we emailed you to play online, add friends and unlock your welcome bonus. Bots, puzzles and the Tour stay open."
      confirmLabel="Verify Now"
      cancelLabel="Not Now"
      onCancel={() => setVisible(false)}
      onConfirm={() => {
        setVisible(false);
        router.push({ pathname: '/verify-email', params: { next: '/home' } });
      }}
    />
  );
}
