/**
 * The single place a transport is chosen. Everything else imports `backend` from here,
 * so adding a Tauri adapter later is one line in this file.
 */

import { httpBackend } from "./http";
import type { VaultBackend } from "./types";

export const backend: VaultBackend = httpBackend;
export type * from "./types";
