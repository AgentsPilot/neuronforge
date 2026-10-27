/**
 * Names set by the hosting platform, the Node.js runtime or the operating
 * system, which the Environment admin page counts instead of listing
 * (requirement §3.3; SA ruling OQ-4).
 *
 * Precedence is fixed by OQ-4: the catalogue first, then this list, then
 * Uncategorised. The classifier only asks this list about names the catalogue
 * does not hold, so it can never hide `NODE_ENV`, `AWS_REGION` or a catalogued
 * `VERCEL_*` name.
 *
 * Both failure directions are safe: a name wrongly listed here is only
 * counted, and a platform name missing from here lands in Uncategorised,
 * masked. Matching is case-insensitive because Windows environment names are
 * (they arrive as `Path`, `windir`, ...).
 *
 * Pure data and one pure function; no imports.
 *
 * @module lib/admin/environment/platformDenyList
 */

/** Prefixes, upper-case. */
export const PLATFORM_NOISE_PREFIXES: readonly string[] = [
  // Hosting platform and serverless runtime
  'VERCEL_',
  'NOW_',
  'AWS_',
  'LAMBDA_',
  // Node.js, npm and Next.js internals (NEXT_PUBLIC_ is excluded below, SA RC-1)
  'NPM_',
  'NODE_',
  'NEXT_',
  '__',
  '_',
  // Shell, locale and desktop
  'LC_',
  'XDG_',
  'GIT_',
  'VSCODE_',
  'TERM_',
  'SSH_',
  'MSYS',
  'MINGW',
  // The coding tool's own namespace only (SA CR-3): an app `CLAUDE_*` setting stays visible.
  'CLAUDE_CODE_',
  // Windows
  'PROCESSOR_',
  'EFC_',
  'FPS_BROWSER_',
  // Toolchains a developer machine carries (Git for Windows, pkg-config, Corepack)
  'PKG_CONFIG_',
  'COREPACK_',
];

/**
 * Prefixes that are always app-defined, so they are never noise even though a
 * broader prefix above matches them. An uncatalogued `NEXT_PUBLIC_*` name is
 * exactly what Uncategorised exists to surface (SA RC-1).
 */
export const PLATFORM_NOISE_PREFIX_EXCEPTIONS: readonly string[] = ['NEXT_PUBLIC_'];

/** Exact names, upper-case. */
export const PLATFORM_NOISE_NAMES: readonly string[] = [
  'PATH',
  'PATHEXT',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'USERDOMAIN',
  'USERDOMAIN_ROAMINGPROFILE',
  'LOGNAME',
  'SHELL',
  'SHLVL',
  'PWD',
  'OLDPWD',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TZ',
  'HOSTNAME',
  'COMPUTERNAME',
  'LOGONSERVER',
  'SESSIONNAME',
  'OS',
  'COMSPEC',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'DRIVERDATA',
  'PSMODULEPATH',
  'NUMBER_OF_PROCESSORS',
  'LD_LIBRARY_PATH',
  'INIT_CWD',
  'EXEPATH',
  'COLORTERM',
  'FORCE_COLOR',
  'NO_COLOR',
  'CI',
  'EDITOR',
  'PAGER',
  'LESS',
  'MANPATH',
  'HISTFILE',
  'MAIL',
  'DISPLAY',
  'CHROME_CRASHPAD_PIPE_NAME',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'ACSVCPORT',
  'ACSETUPSVCPORT',
  'ACLOCAL_PATH',
  'CONFIG_SITE',
  'INFOPATH',
  'ORIGINAL_PATH',
  'ORIGINAL_TEMP',
  'ORIGINAL_TMP',
  'PLINK_PROTOCOL',
  'NODEFAULTCURRENTDIRECTORYINEXEPATH',
  'ZES_ENABLE_SYSMAN',
  // SA CR-3: exact names, not prefixes, so an app setting sharing the start stays visible.
  'CLAUDECODE',
  'ONEDRIVE',
  'ONEDRIVECONSUMER',
  'ONEDRIVECOMMERCIAL',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  // Python's own documented settings (no underscore after PYTHON).
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PYTHONDONTWRITEBYTECODE',
  'PYTHONUNBUFFERED',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
  'PYTHONHASHSEED',
  'PYTHONWARNINGS',
  'PYTHONNOUSERSITE',
  'PYTHONUSERBASE',
  'PYTHONPYCACHEPREFIX',
];

const NAME_SET = new Set(PLATFORM_NOISE_NAMES);

/** True when an uncatalogued name was set by the platform or operating system. */
export function isPlatformNoise(name: string): boolean {
  const upper = name.toUpperCase();
  if (PLATFORM_NOISE_PREFIX_EXCEPTIONS.some((prefix) => upper.startsWith(prefix))) return false;
  if (NAME_SET.has(upper)) return true;
  return PLATFORM_NOISE_PREFIXES.some((prefix) => upper.startsWith(prefix));
}
