// The words and the other section for moving someone between the cooks and the ones who miss it
// (SwitchRoleSheet). Pure, so scripts/test-who.mjs checks them under node.
import type { Role } from '../../lib/api';
import { english, type T } from '../../lib/words/words';

/** The other section. */
export const otherRole = (role: Role): Role => (role === 'cook' ? 'learner' : 'cook');

/** The words for moving `name` (or this phone's own person) into `to`. */
export function switchRoleWords(name: string, own: boolean, to: Role, t: T = english) {
  const cooks = to === 'cook';
  return {
    row: own ? t(cooks ? 'profiles.switch.rowCooksOwn' : 'profiles.switch.rowMissItOwn') : t(cooks ? 'profiles.switch.rowCooks' : 'profiles.switch.rowMissIt', { name }),
    title: own ? t(cooks ? 'profiles.switch.titleCooksOwn' : 'profiles.switch.titleMissItOwn') : t(cooks ? 'profiles.switch.titleCooks' : 'profiles.switch.titleMissIt', { name }),
    line: t(cooks ? 'profiles.switch.lineCooks' : 'profiles.switch.lineMissIt'),
  };
}
