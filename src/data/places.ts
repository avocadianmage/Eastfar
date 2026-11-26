/** Named places that quests can send the player to. */
import { STATUE } from '../world/layout';

export interface Place {
  id: string;
  name: string;
  x: number;
  z: number;
  /** How close counts as having arrived, metres. */
  radius: number;
}

export const PLACES: readonly Place[] = [{ id: 'statue', name: 'Aleric’s Statue', x: STATUE.x, z: STATUE.z, radius: 6 }];
