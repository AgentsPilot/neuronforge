/**
 * WP-57: a `fetch_content` step that feeds a document extractor must bind to the BYTES
 * action (download_file), not the text reader (read_file_content). A fetch that feeds a
 * non-document consumer (AI/text) must keep read_file_content.
 */
import { CapabilityBinderV2 } from '../CapabilityBinderV2';
import googleDriveDef from '@/lib/plugins/definitions/google-drive-plugin-v2.json';
import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json';

const DEFS: Record<string, any> = {
  'google-drive': googleDriveDef,
  'document-extractor': documentExtractorDef,
};

function makeBinder() {
  const pluginManager = {
    getExecutablePlugins: jest.fn().mockResolvedValue({
      'google-drive': { definition: googleDriveDef, connection: { plugin_key: 'google-drive', status: 'active' } },
    }),
    getAvailablePlugins: jest.fn().mockReturnValue({
      'document-extractor': documentExtractorDef, // isSystem: true → merged by bind()
    }),
    getPluginDefinition: jest.fn((key: string) => DEFS[key]),
    getActionDefinition: jest.fn((key: string, action: string) => DEFS[key]?.actions?.[action]),
  } as any;
  return new CapabilityBinderV2(pluginManager);
}

const listStep = {
  id: 'list', kind: 'data_source', summary: 'list files',
  uses: [{ capability: 'list', domain: 'storage' }],
  output: 'files', source: { domain: 'storage', intent: 'list' },
};

function loopWith(consumer: any) {
  return {
    id: 'loop', kind: 'loop', summary: 'per file',
    loop: {
      over: 'files', item_ref: 'file',
      do: [
        {
          id: 'fetch', kind: 'data_source', summary: 'fetch content',
          uses: [{ capability: 'fetch_content', domain: 'storage' }],
          output: 'file_content', source: { domain: 'storage', intent: 'fetch_content' },
        },
        consumer,
      ],
    },
  };
}

const getFetch = (bound: any) =>
  bound.steps.find((s: any) => s.kind === 'loop').loop.do.find((s: any) => s.id === 'fetch');

describe('CapabilityBinderV2 — WP-57 fetch-for-document-extractor preference', () => {
  it('binds a fetch feeding a document extractor to download_file (bytes)', async () => {
    const ic = {
      version: 'intent.v1', goal: 'extract from files',
      steps: [
        listStep,
        loopWith({
          id: 'extract', kind: 'extract', summary: 'extract fields',
          uses: [{ capability: 'extract_structured_data', domain: 'document' }],
          extract: { input: 'file_content', fields: [{ name: 'total', type: 'currency' }] },
          output: 'data',
        }),
      ],
    } as any;

    const fetch = getFetch(await makeBinder().bind(ic, 'test-user'));
    expect(fetch.plugin_key).toBe('google-drive');
    expect(fetch.action).toBe('download_file');
  });

  it('keeps read_file_content when the fetch feeds a non-document (AI/text) step', async () => {
    const ic = {
      version: 'intent.v1', goal: 'summarize files',
      steps: [
        listStep,
        loopWith({
          id: 'gen', kind: 'generate', summary: 'summarize text',
          uses: [{ capability: 'generate', domain: 'internal' }],
          generate: { input: 'file_content', instruction: 'summarize', reason: 'free-form' },
          output: 'data',
        }),
      ],
    } as any;

    const fetch = getFetch(await makeBinder().bind(ic, 'test-user'));
    expect(fetch.plugin_key).toBe('google-drive');
    expect(fetch.action).toBe('read_file_content');
  });
});
