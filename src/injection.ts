import type { InjectionKey, Ref } from 'vue'
import type { StatusPhase } from './composables/useStatuses'

/** Lets any state badge know whether statuses are still on their way. */
export const statusPhaseKey: InjectionKey<Ref<StatusPhase>> = Symbol('statusPhase')

/** Devices drawn on the topology: the Hosts page links to them. */
export const topologyDevicesKey: InjectionKey<Readonly<Ref<ReadonlySet<string>>>> = Symbol('topologyDevices')
