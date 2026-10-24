'use client';
// Provider order (brief 9.1): CopyProvider > MotionProvider > PauseProvider > RelationProvider >
// LenisProvider. Each page renders its own <Providers audience>, so the words (CopyProvider) and the
// meaning of the relation (RelationProvider) follow the version the visitor chose.
import type { ReactNode } from 'react';
import type { Audience } from '@/content/audience';
import { CopyProvider } from './CopyProvider';
import { MotionProvider } from './MotionProvider';
import { PauseProvider } from './PauseProvider';
import { RelationProvider } from './RelationProvider';
import { LenisProvider } from './LenisProvider';

export function Providers({ audience, children }: { audience: Audience; children: ReactNode }) {
  return (
    <CopyProvider audience={audience}>
      <MotionProvider>
        <PauseProvider>
          <RelationProvider audience={audience}>
            <LenisProvider>{children}</LenisProvider>
          </RelationProvider>
        </PauseProvider>
      </MotionProvider>
    </CopyProvider>
  );
}
