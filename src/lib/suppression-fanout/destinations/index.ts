import { alloDestination } from "./allo-dest";
import { centralDestination } from "./central";
import { rvmDestination } from "./rvm";
import { smartleadDestination } from "./smartlead";
import type { Destination, DestinationId } from "../types";

export const defaultDestinations: Destination[] = [
  rvmDestination,
  centralDestination,
  smartleadDestination,
  alloDestination,
];

export function destinationById(
  destinations: Destination[],
  id: DestinationId,
): Destination | undefined {
  return destinations.find((d) => d.id === id);
}
