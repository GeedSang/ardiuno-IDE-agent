"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coreIdFromFqbn = coreIdFromFqbn;
exports.missingPlatformFromLog = missingPlatformFromLog;
function coreIdFromFqbn(fqbn) {
    const parts = fqbn.trim().split(':');
    return parts.length >= 3 && parts[0] && parts[1] ? `${parts[0]}:${parts[1]}` : undefined;
}
function missingPlatformFromLog(log) {
    const match = log.match(/Platform\s+['"]([^'"]+)['"]\s+not found|platform\s+([^\s'"`]+)\s+(?:is\s+)?not installed/i);
    return match?.[1] || match?.[2];
}
//# sourceMappingURL=cliRecovery.js.map