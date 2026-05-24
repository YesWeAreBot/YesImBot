import type { AthenaEvent } from "./types.js";
import { PlatformAdapter } from "./types.js";

export class GenericAdapter extends PlatformAdapter {
  platform = "*";

  install(_emit: (event: AthenaEvent) => void): void {
    // Compatibility shim only. Koishi session observation now belongs to AthenaBotService.
  }
}
