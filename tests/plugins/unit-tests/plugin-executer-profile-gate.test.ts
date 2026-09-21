/**
 * PluginExecuterV2 profile gate.
 *
 * Covers requirement BUSINESS_OS_PLUGIN_PROFILE AC8, AC9 and AC10: a registered
 * plugin outside the active profile gets a clean, non-throwing `plugin_not_enabled`
 * result (or a throw from fetchDynamicOptions, whose contract is throw-on-failure)
 * without its executor ever being constructed. An unregistered key keeps today's
 * `execution_error`, so "not enabled" and "not registered" stay distinct.
 */

const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
};
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
      trace: (...a: unknown[]) => mockLog.trace(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), logger: make() };
});

// The registry imports this class statically; the mock replaces it there, so a
// constructor call count of 0 proves the gate stopped before construction.
jest.mock('@/lib/server/gmail-plugin-executor', () => ({ GmailPluginExecutor: jest.fn() }));

// In-profile control: a stub CRM executor, so the positive path proves the gate
// lets a business_os plugin through to construction and execution.
const mockCrmExecuteAction = jest.fn();
jest.mock('@/lib/server/crm-plugin-executor', () => ({
  CRMPluginExecutor: jest.fn().mockImplementation(() => ({
    executeAction: (...a: unknown[]) => mockCrmExecuteAction(...a),
  })),
}));

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';
import { CRMPluginExecutor } from '@/lib/server/crm-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { getPluginProfile } from '@/lib/server/plugin-profile';
import { createMockUserConnections } from '../common/mock-user-connections';

const GmailCtor = GmailPluginExecutor as unknown as jest.Mock;
const CrmCtor = CRMPluginExecutor as unknown as jest.Mock;
const NOT_ENABLED = "Plugin 'google-mail' is not enabled in the 'business_os' plugin profile";

let executer: PluginExecuterV2;

beforeAll(async () => {
  const manager = new PluginManagerV2(createMockUserConnections());
  await manager.initializeWithCorePlugins(getPluginProfile('business_os'));
  jest.spyOn(PluginManagerV2, 'getInstance').mockResolvedValue(manager);
  executer = await PluginExecuterV2.getInstance();
});

beforeEach(() => {
  Object.values(mockLog).forEach(fn => fn.mockClear());
  GmailCtor.mockClear();
});

describe('[smoke] plugin executer profile gate', () => {
  it('resolves to plugin_not_enabled for a registered plugin outside the profile', async () => {
    const result = await executer.execute('user-1', 'google-mail', 'send_email', {});

    expect(result).toEqual({ success: false, error: 'plugin_not_enabled', message: NOT_ENABLED });
    expect(GmailCtor).not.toHaveBeenCalled();
  });

  it('lets an in-profile plugin through to construction and execution', async () => {
    // Guards against a gate that blocks everything, which the negative cases alone
    // would not catch.
    const crmResult = { success: true, data: { contacts: [] } };
    mockCrmExecuteAction.mockResolvedValueOnce(crmResult);

    const result = await executer.execute('user-1', 'crm', 'list_contacts', { limit: 5 });

    expect(result.error).not.toBe('plugin_not_enabled');
    expect(result).toEqual(crmResult);
    expect(CrmCtor).toHaveBeenCalledTimes(1);
    expect(mockCrmExecuteAction).toHaveBeenCalledWith('user-1', 'list_contacts', { limit: 5 });
    expect(mockLog.info).toHaveBeenCalledWith(
      { userId: 'user-1', pluginName: 'crm', actionName: 'list_contacts' },
      'Executing plugin action'
    );
    expect(mockLog.warn).not.toHaveBeenCalled();
  });
});

describe('[full] plugin executer profile gate', () => {
  it('logs one warn with the owner and no execution line', async () => {
    await executer.execute('user-1', 'google-mail', 'send_email', {});

    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).toHaveBeenCalledWith(
      { userId: 'user-1', pluginKey: 'google-mail', profile: 'business_os', actionName: 'send_email' },
      'Plugin not enabled in active profile'
    );
    expect(mockLog.error).not.toHaveBeenCalled();
    expect(mockLog.info.mock.calls.map(([, message]) => message)).not.toContain('Executing plugin action');
  });

  it('keeps execution_error for a key that is not registered at all', async () => {
    const result = await executer.execute('user-1', 'does-not-exist', 'anything', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_error');
    expect(result.message).toContain('Plugin executor not found');
  });

  it('does not treat prototype names as registered plugins', async () => {
    const result = await executer.execute('user-1', 'constructor', 'anything', {});

    expect(result.error).not.toBe('plugin_not_enabled');
  });

  it('rejects fetchDynamicOptions for a plugin outside the profile without constructing it', async () => {
    await expect(executer.fetchDynamicOptions('google-mail', 'listLabels', {}, {})).rejects.toThrow(NOT_ENABLED);

    expect(GmailCtor).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      { pluginKey: 'google-mail', profile: 'business_os' },
      'Plugin not enabled in active profile'
    );
  });
});
