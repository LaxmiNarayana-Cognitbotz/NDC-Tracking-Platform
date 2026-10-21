/**
 * Master Feature Flag Configuration (Client Code)
 * ------------------------------------------------
 * Set to:
 *  - true  : Shows all enhancement tabs (Credentials, Automation/Sync, Email & CC Rules, SharePoint Docs, Audit Logs)
 *  - false : Hides all enhancement features and displays ONLY the baseline 'Users & Access' tab.
 *
 * You can toggle it directly by changing the boolean below or via VITE_ENHANCEMENT_FEATURES in client/.env.
 */
const envOverride = import.meta.env.VITE_ENHANCEMENT_FEATURES;

// DIRECT CLIENT CODE TOGGLE: Set to true or false right here
const CODE_TOGGLE: boolean = true;

export const ENHANCEMENT_FEATURES: boolean =
  typeof envOverride !== "undefined" && envOverride !== ""
    ? envOverride !== "false" && envOverride !== false
    : CODE_TOGGLE;

