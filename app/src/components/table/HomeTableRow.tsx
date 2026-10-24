// "This week at the table" on the cook Home (RETENTION-HANDOFF 3.2), wired: the shared GET /table
// (lib/tableApi useTable), the family from the session, and what a tap does.
//   - a face -> the 1:1 chat with that person (lib/messaging openChatWith), like MembersSheet's
//     "Message", for everyone who can read it: their own phone, or a phone lent to them. Opening it
//     is a round trip, so that face shows a spinner and the rest of the row rests until the chat
//     slides in or the error toast shows (MembersSheet's `opening`);
//   - someone invited who hasn't joined yet (no phone in the family yet) -> PersonSheet ("Dad hasn't
//     joined yet." with Send again): a chat would wait for someone who isn't here;
//   - "+N" (more faces than fit) -> MembersSheet, everyone with a Message pill. The row gets the whole
//     family (tableFaces), so N counts everyone the row couldn't fit.
// My own face is shown ("You") but isn't a button (TableRow). A memorial person isn't on the row at
// all (tableFaces; guardrails 2 & 7: this week's table would keep them unlit and treat them as
// present; TODO(caleb) #5). The row hides itself until the table answers and when nobody but me is
// here, unless `right` holds something.
//
//   <HomeTableRow style={{ paddingHorizontal: space.gutter }} />            // cook Home: `large`
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { MembersSheet } from '@/components/messages/MembersSheet';
import { PersonSheet } from '@/components/profiles/PersonSheet';
import { useToast } from '@/components/ui';
import { errorMessage, type Profile } from '@/lib/api';
import { openChatWith } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { tableFaces, type TableFaceProfile } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';

import { TableRow } from './TableRow';

export function HomeTableRow({
  large,
  dense,
  right,
  style,
}: {
  large?: boolean;
  dense?: boolean;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { me, profiles } = useSession();
  const toast = useToast();
  const { table } = useTable();
  const faces = useMemo(() => tableFaces(profiles, table, me?.id), [profiles, table, me?.id]);
  const [membersOpen, setMembersOpen] = useState(false);
  // The sheet keeps showing its person while it slides away, so `person` outlives `personOpen`.
  const [person, setPerson] = useState<Profile | null>(null);
  const [personOpen, setPersonOpen] = useState(false);
  // The face whose chat is opening (its cell shows a spinner); the ref also stops a second tap that
  // lands before the re-render.
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);

  const openFace = useCallback(
    async (face: TableFaceProfile) => {
      const p = profiles.find((x) => x.id === face.id);
      // tableFaces leaves memorial people out; this keeps their chat closed if that ever changes.
      if (!p || p.memorial === true || openingRef.current) return;
      if (p.invited && !p.locked) {
        setPerson(p);
        setPersonOpen(true);
        return;
      }
      openingRef.current = true;
      setOpening(p.id);
      const done = () => {
        openingRef.current = false;
        setOpening(null);
      };
      try {
        const id = await openChatWith(p.id);
        router.push({ pathname: '/chat/[id]', params: { id } });
        // The spinner stays while the chat slides in over the Home; a second tap meanwhile does nothing.
        setTimeout(done, 400);
      } catch (e) {
        done();
        toast.show(errorMessage(e, 'That didn’t open. Try again.'), { tone: 'error' });
      }
    },
    [profiles, toast],
  );

  return (
    <>
      <TableRow
        faces={faces}
        large={large}
        dense={dense}
        right={right}
        busyId={opening}
        onPressFace={(p) => void openFace(p)}
        onPressMore={() => setMembersOpen(true)}
        style={style}
      />
      <MembersSheet visible={membersOpen} onClose={() => setMembersOpen(false)} />
      <PersonSheet visible={personOpen} person={person} onClose={() => setPersonOpen(false)} />
    </>
  );
}
