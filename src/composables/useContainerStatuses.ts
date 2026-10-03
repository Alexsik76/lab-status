import { fetchContainerStatuses } from '../api/containerStatus'
import type { DockerContainerEntry } from '../types/containerStatus'
import { type LivePhase, useLiveSource } from './useLiveSource'

export type ContainerStatusPhase = LivePhase

/**
 * Live Docker container states. Loads independently from service checks and inventory.
 */
export function useContainerStatuses() {
  return useLiveSource<DockerContainerEntry[], DockerContainerEntry[]>({
    fetcher: fetchContainerStatuses,
    defaultIndex: [],
  })
}
