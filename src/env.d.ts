/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time override of the n8n status endpoint. */
  readonly VITE_STATUS_URL?: string
}
