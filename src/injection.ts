import type { InjectionKey, Ref } from 'vue'
import type { StatusPhase } from './composables/useStatuses'

/** Lets any state badge know whether statuses are still on their way. */
export const statusPhaseKey: InjectionKey<Ref<StatusPhase>> = Symbol('statusPhase')
