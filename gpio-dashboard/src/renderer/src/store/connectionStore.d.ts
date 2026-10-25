// Types for the JavaScript connection store, for TypeScript callers: only what they read.
import type { StoreApi, UseBoundStore } from 'zustand'

interface ConnectionState {
  status: string
  agentStatus: string
}

declare const useConnectionStore: UseBoundStore<StoreApi<ConnectionState>>
export default useConnectionStore
