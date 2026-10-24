'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CRMPipelineView } from '@/components/crm/CRMPipelineView';
import { ContactsPager } from '@/components/crm/ContactsPager';
import { CRMSubscriberList } from '@/components/crm/CRMSubscriberList';
import { CRMContactList } from '@/components/crm/CRMContactList';
import { CRMTaskList } from '@/components/crm/CRMTaskList';
import { CRMContactModal } from '@/components/crm/CRMContactModal';
import { CRMTaskModal } from '@/components/crm/CRMTaskModal';
import { CRMContactDrawerV2 } from '@/components/crm/contact-drawer';
import { Plus, Search, Users, Download, LayoutGrid, List, CheckSquare, Mail } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { ContactSearchField } from '@/components/crm/ContactSearchField';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';
import { usePhoneLibSettled } from '@/components/crm/usePhoneLib';

const logger = createLogger({ module: 'CRMPage' });

type ViewMode = 'pipeline' | 'contacts' | 'subscribers' | 'tasks';

/**
 * The drawer's collapsible sections, as `CRMContactDrawerV2.initialSection`
 * declares them.
 *
 * Written out here so a `?section=` value off the URL can be CHECKED against it
 * rather than cast into the drawer's union. A cast would compile and then hand
 * the drawer a section name it has no panel for, which opens with everything
 * collapsed and no clue why.
 */
const DRAWER_SECTIONS = ['details', 'bookings', 'tasks', 'forms', 'files', 'payments'] as const;
type DrawerSection = (typeof DRAWER_SECTIONS)[number];

/** The requested section, or undefined for anything we do not recognise. */
function sectionFromUrl(value: string | null): DrawerSection | undefined {
  return DRAWER_SECTIONS.includes(value as DrawerSection) ? (value as DrawerSection) : undefined;
}

export default function CRMPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, language } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [isNewContactModalOpen, setIsNewContactModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<any>(null);
  const [taskListKey, setTaskListKey] = useState(0); // For refreshing task list
  const [contacts, setContacts] = useState<CRMContact[]>([]); // All contacts for pipeline view
  const [pipelineStages, setPipelineStages] = useState<CRMPipelineStage[]>([]);
  /**
   * Whether the stage request has FINISHED — success, empty or failed.
   *
   * `pipelineStages.length` alone cannot tell "not asked yet" from "the
   * business has none". The board waited on the length, so an account with no
   * stages (or a failed stage request) sat behind the spinner forever.
   */
  const [stagesLoaded, setStagesLoaded] = useState(false);
  /**
   * The stage request failed, as opposed to answering "none".
   *
   * Without it a failed request read as an empty pipeline, and the owner was
   * told they had no stages when they had six and the server had a bad moment.
   */
  const [stagesFailed, setStagesFailed] = useState(false);
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Which collapsible section the drawer opens on.
   *
   * Widened from `'details' | 'tasks'` to the drawer's full set, so a link can
   * land somebody on the part of the record it is about. `NeedsYouCard`'s
   * "write a quote" sends `&section=bookings`, where the consultation and the
   * quote action actually are; before this it sent `&action=quote`, which
   * nothing read, so the button opened the drawer on the details section and
   * left the owner to find the booking themselves.
   */
  const [drawerDefaultTab, setDrawerDefaultTab] = useState<DrawerSection | undefined>(undefined);
  /**
   * Which booking the drawer opens expanded, when a link named one.
   *
   * `&section=bookings` got the owner to the right LIST; `&booking=` gets them
   * to the row. `NeedsYouCard` has always known which booking its gap was
   * raised from and was dropping it at the point of navigating, so every
   * "write a quote" / "bill this phase" / "say what happened" button landed on
   * a list of that contact's bookings and left them to find the one it meant.
   */
  const [drawerFocusBookingId, setDrawerFocusBookingId] = useState<string | undefined>(undefined);
  // Pagination state for contacts list view
  const [currentPage, setCurrentPage] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  /** How many contacts each stage really holds — the column header's number. */
  const [stageTotals, setStageTotals] = useState<Record<string, number>>({});
  /** Twenty, as the money list uses. See components/payments/MoneyList.tsx. */
  const PAGE_SIZE = 20;

  // Fetch pipeline stages and capabilities on mount
  useEffect(() => {
    fetchPipelineStages();
    fetchCapabilities();
  }, []);

  /*
   * On a narrow screen the CRM opens on Contacts, not the board.
   *
   * The pipeline is six columns sharing one row: they are `flex-1` with
   * `truncate`, so they never overflow — they just get narrower, and on a phone
   * each stage has about 60px. The labels degrade to "Disc…" / "Prop…", the
   * flow segments become slivers, and dragging a card to a stage you cannot
   * see is not a gesture anyone can complete. The list shows the same contacts
   * with their stage written out.
   *
   * Only the DEFAULT moves. The Pipeline tab is still there and still works;
   * this runs once on mount and never again, so tapping back to the board
   * sticks for the rest of the session.
   *
   * Mount, not render: `window` does not exist server-side, and reading it
   * during render would make the server and client disagree about which tab is
   * active. There is no flash — the view is behind the `loading` gate until
   * the first fetch resolves, and this has run long before then.
   */
  useEffect(() => {
    if (window.matchMedia('(max-width: 700px)').matches) {
      setViewMode('contacts');
    }
  }, []);

  /*
   * PERF-2: the phone library is fetched after first paint instead of with
   * the page. Mounting this hook starts that download (the new-contact modal
   * and the drawer mount only on click, so they cannot start it themselves).
   *
   * A deep link (`?contact=`) opens the drawer at load, with its details
   * section, phone field included, already expanded. It waits for the
   * library to SETTLE, so the field is drawn with the rest of the section and
   * never arrives a moment late (AC-2.3). Settled includes a failed download,
   * so a network error can never stop the drawer opening; it only means the
   * field shows its placeholder.
   */
  const phoneLibSettled = usePhoneLibSettled();

  /*
   * Handle contact query parameter - open specific contact drawer.
   *
   * Waits for the first list load to FINISH, not for it to return rows. It
   * used to wait on `contacts.length > 0`, so on a list that loads empty — a
   * board with no stages, a business with no contacts on page one — the link
   * was never followed and `?contact=` sat in the address bar. `loading` comes
   * down in the same render the rows land in, so the in-list lookup below
   * still sees them; an empty list just goes straight to the direct fetch.
   */
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (contactId && !loading && phoneLibSettled) {
      // `?section=` decides which part of the record opens. Absent or unknown
      // falls back to details, which is what every link did before it existed.
      const section = sectionFromUrl(searchParams.get('section'));
      // Read before the param is cleared below, and kept in state: the drawer
      // may mount after this effect has already wiped the URL.
      const bookingId = searchParams.get('booking') ?? undefined;
      const contact = contacts.find(c => c.id === contactId);
      if (contact) {
        setDrawerDefaultTab(section ?? 'details');
        setDrawerFocusBookingId(bookingId);
        setSelectedContact(contact);
        // Clear the query param from URL after opening
        router.replace('/business-os/crm', { scroll: false });
      } else {
        // Contact not in current list - fetch it directly. The section has to go
        // with it: this is the path a link from another page usually takes, since
        // the contact it names is often not on the first page of this list.
        fetchContactById(contactId, section, bookingId);
      }
    }
  }, [searchParams, contacts, loading, phoneLibSettled]);

  // Handle task query parameter - fetch task to get contact_id, then open drawer with tasks tab
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (taskId) {
      fetchTaskAndOpenDrawer(taskId);
    }
  }, [searchParams]);

  const fetchTaskAndOpenDrawer = async (taskId: string) => {
    try {
      logger.info({ taskId }, 'Fetching task to open drawer');
      const response = await fetch(`/api/crm/tasks/${taskId}`);
      const data = await response.json();
      logger.info({ taskId, success: data.success, hasTask: !!data.task, contactId: data.task?.contact_id }, 'Task fetch result');

      if (data.success && data.task) {
        if (data.task.contact_id) {
          // Task is linked to a contact - fetch contact and open drawer with tasks tab
          const contactResponse = await fetch(`/api/crm/contacts/${data.task.contact_id}`);
          const contactData = await contactResponse.json();
          logger.info({ contactId: data.task.contact_id, success: contactData.success }, 'Contact fetch result');

          if (contactData.success && contactData.contact) {
            setDrawerDefaultTab('tasks');
            setSelectedContact(contactData.contact);
            router.replace('/business-os/crm', { scroll: false });
          }
        } else {
          // Standalone task (no contact) - for now, just clear the URL
          // TODO: Could show a task modal here
          logger.info({ taskId }, 'Task has no contact_id - standalone task');
          router.replace('/business-os/crm', { scroll: false });
        }
      }
    } catch (error) {
      logger.error({ err: error, taskId }, 'Failed to fetch task by ID');
    }
  };

  /**
   * Open a contact named by `?contact=` that is not on the current page of the
   * list.
   *
   * The URL parameter is cleared whatever happens, and that is the point. It
   * used to be cleared only alongside a successful open, so a link naming a
   * contact that no longer exists — a deleted one, most often — left `?contact=`
   * sitting in the address bar. The effect that calls this runs on
   * `[searchParams, contacts]`, so every later refresh of the list fired the
   * same doomed fetch again: silently, forever, and once per edit anywhere on
   * the page, because saving a contact refreshes the list.
   *
   * A link is consumed by being followed. If the contact could not be opened,
   * the honest outcome is the list with a clean URL, not a parameter that
   * retries on a loop with nothing to show for it.
   */
  const fetchContactById = async (contactId: string, section?: DrawerSection, bookingId?: string) => {
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`);
      const data = await response.json();
      if (data.success && data.contact) {
        setDrawerDefaultTab(section ?? 'details');
        setDrawerFocusBookingId(bookingId);
        setSelectedContact(data.contact);
      } else {
        logger.warn(
          { contactId, status: response.status },
          'Link named a contact that could not be opened; staying on the list'
        );
      }
    } catch (error) {
      logger.error({ err: error, contactId }, 'Failed to fetch contact by ID');
    } finally {
      router.replace('/business-os/crm', { scroll: false });
    }
  };

  /**
   * Searching always returns to the first page, set in the same update as the
   * query itself.
   *
   * React batches the two, so the effect below sees one change and fetches
   * once. Resetting in an effect of its own instead would fetch twice: once for
   * the new query at the old page, then again after the reset.
   *
   * And it has to reset at all — staying on page five of a result set that now
   * has two asks the server for an offset past the end and shows nothing.
   */
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  /*
   * WHAT THIS ACCOUNT CAN BE FILTERED BY — its own vocabulary, not a constant.
   *
   * Stages are configured per account. Sources and tags are whatever this
   * business has actually recorded, read off the contacts on hand: offering
   * `source:newsletter` to somebody who has never run one is a filter that can
   * only return nothing, which is the product asserting a capability it does
   * not have.
   *
   * Derived rather than fetched. The list is already here, and a second request
   * for a vocabulary that only exists because of these rows would be a second
   * answer to the same question.
   */
  const stageOptions = useMemo(
    () => pipelineStages.map(stage => ({ value: stage.stage_key, label: stage.stage_label })),
    [pipelineStages]
  );

  /*
   * One reading of what a source is CALLED, used by the filter panel and by the
   * export. Two would drift, and the export is where a drift shows up as
   * `website_booking` in a column somebody sends to an accountant.
   */
  const sourceLabel = useMemo(
    () => (source: string | null | undefined) => {
      const key = source?.trim();
      if (!key) return '';
      /* `website_booking` reads as "website booking" where the product has no
         label for it, which is most of them. */
      return t(`crm.source.${key}`) !== `crm.source.${key}`
        ? t(`crm.source.${key}`)
        : key.replace(/_/g, ' ');
    },
    [t]
  );

  const sourceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const contact of contacts) {
      const source = contact.source?.trim();
      if (!source) continue;
      seen.set(source.toLowerCase(), sourceLabel(source));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [contacts, sourceLabel]);

  const tagOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const contact of contacts) for (const tag of contact.tags ?? []) seen.add(tag);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  /* The business's own date. The route resolves the same one from
     `user_preferences`, so a period means the same on both sides. */
  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);

  /**
   * The board loads each column separately.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A single global page spread twenty contacts across four columns, so a stage
   * holding sixty people showed whichever handful fell inside that window and
   * looked nearly empty. The column is the unit somebody reads, so the column
   * is the unit that pages.
   *
   * The rows still arrive as ONE flat array, because that is what the board
   * already groups and what its drag-and-drop and optimistic moves operate on.
   * Only the filling changes; none of that logic does.
   *
   * `stageTotals` carries the real size of each column, which is the number its
   * header shows and the thing that decides whether there is more to load.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const fetchBoard = async (silent: boolean = false) => {
    // No columns, nothing to ask for. Only reached once the stages have loaded
    // (the effect below waits for that), so the spinner must come down here or
    // nothing else will take it down.
    if (!pipelineStages.length) {
      if (!silent) setLoading(false);
      return;
    }

    try {
      if (!silent) setLoading(true);

      const pages = await Promise.all(
        pipelineStages.map(async stage => {
          const params = new URLSearchParams();
          params.set('stage', stage.stage_key);
          params.set('limit', String(PAGE_SIZE));
          params.set('offset', '0');
          if (searchQuery) params.set('search', searchQuery);

          const response = await fetch(`/api/crm/contacts?${params}`);
          const data = await response.json();
          return {
            key: stage.stage_key,
            rows: (data.success ? data.contacts : []) ?? [],
            total: (data.success ? data.total : 0) ?? 0,
          };
        })
      );

      setContacts(pages.flatMap(p => p.rows));
      setStageTotals(Object.fromEntries(pages.map(p => [p.key, p.total])));
      setTotalContacts(pages.reduce((sum, p) => sum + p.total, 0));
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch the board');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  /** The next twenty for one column, appended to what is already shown. */
  const loadMoreStage = async (stageKey: string) => {
    try {
      const params = new URLSearchParams();
      params.set('stage', stageKey);
      params.set('limit', String(PAGE_SIZE));
      // How many of this stage are already on screen. Derived rather than
      // tracked, so it cannot fall out of step with what was actually loaded.
      params.set('offset', String(contacts.filter(c => c.stage === stageKey).length));
      if (searchQuery) params.set('search', searchQuery);

      const response = await fetch(`/api/crm/contacts?${params}`);
      const data = await response.json();
      if (!data.success) return;

      setContacts(prev => [...prev, ...(data.contacts ?? [])]);
    } catch (error) {
      logger.error({ err: error, stageKey }, 'Failed to load more for this column');
    }
  };

  /*
   * Refetch whenever the search or the page changes.
   *
   * The page is part of the REQUEST now, not a slice applied afterwards, so
   * moving to page two without refetching would advance the pager and leave the
   * same twenty rows underneath it.
   *
   * A new search goes back to page one in the same pass: staying on page five
   * of a result set that now has two pages asks the server for an offset past
   * the end and shows an empty board.
   */
  useEffect(() => {
    // The board pages per column and ignores `currentPage`; the list pages
    // globally. `pipelineStages` and `stagesLoaded` are dependencies because the
    // board cannot ask for its columns until it knows what they are — or that
    // there are none.
    if (viewMode === 'pipeline') {
      if (!stagesLoaded) return;
      fetchBoard();
    } else {
      fetchContacts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, currentPage, viewMode, pipelineStages, stagesLoaded]);

  const fetchPipelineStages = async () => {
    try {
      const response = await fetch('/api/crm/pipeline-stages');
      const data = await response.json();
      if (data.success) {
        setPipelineStages(data.stages || []);
        setStagesFailed(false);
      } else {
        logger.warn({ status: response.status, error: data.error }, 'Pipeline stages request was refused');
        setStagesFailed(true);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch pipeline stages');
      setStagesFailed(true);
    } finally {
      setStagesLoaded(true);
    }
  };

  const fetchCapabilities = async () => {
    try {
      const response = await fetch('/api/capabilities');
      const data = await response.json();
      if (data.success) {
        setEnabledCapabilities(data.enabledKeys || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch capabilities');
    }
  };

  // Fetch ALL contacts (for pipeline view and total count)
  const fetchContacts = async (silent: boolean = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }

      /*
       * One page at a time, from the server.
       *
       * ─────────────────────────────────────────────────────────────────────
       * This asked for everything — "No limit - fetch all contacts for
       * pipeline view" — and the route answers `limit: validated.limit || 50`.
       * So the board silently stopped at fifty, ordered newest first, which
       * meant the contacts that disappeared were the OLDEST: the established
       * clients. Dragging between stages then operated on an incomplete set.
       *
       * The count was wrong in the same breath. The API returns the real total
       * alongside the rows, and this took `allContacts.length` instead — so a
       * business with a hundred contacts was told it had fifty, by a number
       * derived from the truncation itself.
       *
       * The schema caps `limit` at 100, so asking for everything was never
       * going to work however it was phrased.
       * ─────────────────────────────────────────────────────────────────────
       */
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((currentPage - 1) * PAGE_SIZE));

      const response = await fetch(`/api/crm/contacts?${params}`);
      const data = await response.json();

      if (data.success) {
        setContacts(data.contacts || []);
        // The count of everything that MATCHES, not of what came back.
        setTotalContacts(data.total ?? 0);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch contacts');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  // Get paginated contacts for list view
  /*
   * No slice: `contacts` IS the current page now.
   *
   * It used to be a client-side window over an array the API had already
   * truncated — five pages of ten over fifty rows, presented as the whole
   * pipeline.
   */
  const paginatedContacts = contacts;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  /**
   * A contact was created. The modal has served its purpose, so it closes —
   * there is no record being edited to stay on.
   *
   * The refresh is silent: the list is already on screen with real rows in it,
   * and replacing them with the full-page spinner to add one more reads as the
   * page reloading. The new contact simply appears.
   */
  const handleContactCreated = () => {
    setIsNewContactModalOpen(false);
    // Whichever view is on screen: a contact created while the board is open
    // belongs in a column, and refreshing the list would not put it there.
    void (viewMode === 'pipeline' ? fetchBoard(true) : fetchContacts(true));
  };

  /**
   * A contact changed. Refresh what is on screen without taking it away.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This was `setSelectedContact(null); fetchContacts();` — so editing one
   * field closed the drawer and put the whole list behind the loading spinner,
   * because `fetchContacts()` defaults to the non-silent path. Three things
   * followed, and all three were live:
   *
   *   - The owner was thrown out of the record they were editing, and had to
   *     find and reopen it to make the next change.
   *   - The drawer's own "Saved" message is shown for two seconds; it was
   *     unmounted immediately, so the confirmation never appeared.
   *   - A booking saved from inside the drawer had to deliberately NOT report
   *     itself, to avoid being ejected — so the list silently kept stale data.
   *
   * With the saved row in hand the drawer is re-pointed at it rather than
   * closed, and the list refreshes silently underneath. Called with nothing —
   * a deletion, a booking — it just re-reads the list; a deletion has already
   * closed the drawer through `onClose`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const handleContactUpdated = (updated?: CRMContact) => {
    if (updated) {
      setSelectedContact(updated);
    }
    /*
     * Refresh whichever view is on screen.
     *
     * The board opens this same drawer, and this only ever refreshed the LIST —
     * so a contact edited from the pipeline left its card showing the old
     * values, and a stage change left it in the old column, until something
     * else happened to reload. Both were true before the drawer stayed open;
     * they were just harder to notice behind the close-and-reload.
     */
    void (viewMode === 'pipeline' ? fetchBoard(true) : fetchContacts(true));
  };

  const handleContactClick = (contact: CRMContact) => {
    setDrawerDefaultTab('details');
    setSelectedContact(contact);
  };

  const handleContactClickFromTaskList = (contact: CRMContact) => {
    setDrawerDefaultTab('tasks');
    setSelectedContact(contact);
  };

  const handleExportCSV = () => {
    if (contacts.length === 0) return;

    // Define CSV headers
    const headers = [
      t('crm.export.first_name'),
      t('crm.export.last_name'),
      t('crm.export.email'),
      t('crm.export.phone'),
      t('crm.export.stage'),
      t('crm.export.source'),
      t('crm.export.tags'),
      t('crm.export.created_at')
    ];

    /*
     * A PHONE NUMBER IS TEXT, and a spreadsheet does not agree.
     *
     * ───────────────────────────────────────────────────────────────────────
     * CSV quoting is syntax, not type: Excel reads `"0543254785"` as the
     * NUMBER 543254785 and the leading zero is gone — an Israeli mobile
     * arriving in an export one digit short. `="..."` is the one form Excel,
     * Google Sheets and Numbers all read back as text.
     *
     * The value itself is left exactly as stored. Six of the twelve phones on
     * this platform carry no country code, and this account holds both +972
     * and +1 numbers, so there is no country to apply that would not be a
     * guess — and a wrong country code on an exported list is worse than a
     * bare national number, because it looks dialable.
     * ───────────────────────────────────────────────────────────────────────
     */
    const asText = (value: string) => (value ? `="${value.replace(/"/g, '""')}"` : '');

    // Map contacts to CSV rows
    const rows = contacts.map(contact => [
      contact.first_name || '',
      contact.last_name || '',
      contact.email || '',
      asText(contact.phone || ''),
      /* The words the owner configured, not the key the column holds.
         `family_enrolled` is an implementation detail of this product; the
         person reading the export has never seen it. */
      stageOptions.find(option => option.value === contact.stage)?.label ?? contact.stage ?? '',
      sourceLabel(contact.source),
      (contact.tags || []).join('; '),
      contact.created_at ? new Date(contact.created_at).toLocaleDateString() : ''
    ]);

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        row
          .map(cell => {
            const text = String(cell);
            /* Already a formula-quoted cell — quoting it again would ship the
               `="..."` to the reader as literal characters. */
            return text.startsWith('="') ? text : `"${text.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
    ].join('\n');

    // Create and trigger download
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="min-h-full bg-[var(--v2-bg)]">

      {/* Main Content with max-width like dashboard */}
      <div className={`${PAGE_CONTAINER} py-6 sm:py-8 space-y-8`}>

        {/* Page Header with purple theme (CRM capability color) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)' }}>
              <Users className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#8B5CF6' }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] truncate">{t('capability.crm.name')}</h1>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-0.5 sm:mt-1 hidden sm:block">{t('crm.subtitle')}</p>
            </div>
          </div>

          {/*
            `md:overflow-visible`, and that is the whole fix for the clipped box.
            ───────────────────────────────────────────────────────────────────
            The row scrolls sideways on a phone so the buttons stay reachable.
            But `overflow-x-auto` cannot clip one axis alone — CSS promotes the
            other from `visible` to `auto` — so the FOCUS RING, which Tailwind
            draws outside the element's border box, was cut off top and bottom
            the moment the search box was focused. It reads as a half-drawn
            frame around the field you are typing in.

            Only below `md`, because the field itself is `hidden md:block`: on
            every screen where the box exists, nothing needs to scroll here.
          */}
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-x-auto md:overflow-visible pb-2 sm:pb-0">
            {/*
              The orders search, for contacts. One box, chips in it, a ⊕ that
              answers "what can I filter by?" — the same field an owner has
              already learned once, rather than something like it.
            */}
            <ContactSearchField
              value={searchQuery}
              onChange={handleSearchChange}
              today={today}
              language={language as 'en' | 'es' | 'he'}
              stages={stageOptions}
              sources={sourceOptions}
              tags={tagOptions}
              placeholder={
                viewMode === 'tasks'
                  ? (t('crm.tasks.search_placeholder') || 'Search tasks...')
                  : t('crm.search_placeholder')
              }
              t={t}
              className="hidden w-64 md:block lg:w-80"
            />

            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={contacts.length === 0}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[var(--v2-text-secondary)] text-xs sm:text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('crm.export.tooltip')}
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{t('crm.export.button')}</span>
            </button>

            {/* View Mode Tabs */}
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-0.5 sm:p-1 inline-flex gap-0.5 sm:gap-1 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'pipeline'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('pipeline')}
                title={t('crm.tab_pipeline')}
              >
                <LayoutGrid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'contacts'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('contacts')}
                title={t('crm.tab_contacts')}
              >
                <List className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'subscribers'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('subscribers')}
                title={t('crm.tab_subscribers')}
              >
                <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'tasks'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('tasks')}
                title={t('crm.tab_tasks')}
              >
                <CheckSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </div>

            {viewMode === 'tasks' ? (
              <button
                onClick={() => setIsNewTaskModalOpen(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[#8B5CF6] text-xs sm:text-sm font-medium border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 transition-all whitespace-nowrap"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('crm.tasks.add_task')}</span>
                <span className="xs:hidden">{t('crm.add_short')}</span>
              </button>
            ) : (
              <button
                onClick={() => setIsNewContactModalOpen(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[#8B5CF6] text-xs sm:text-sm font-medium border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 transition-all whitespace-nowrap"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('crm.add_contact')}</span>
                <span className="xs:hidden">{t('crm.add_short')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Search Bar - Only visible on mobile */}
        <ContactSearchField
          value={searchQuery}
          onChange={handleSearchChange}
          today={today}
          language={language as 'en' | 'es' | 'he'}
          stages={stageOptions}
          sources={sourceOptions}
          tags={tagOptions}
          placeholder={
            viewMode === 'tasks'
              ? (t('crm.tasks.search_placeholder') || 'Search tasks...')
              : t('crm.search_placeholder')
          }
          t={t}
          className="md:hidden"
        />

        {/* Content */}
        {loading || (viewMode === 'pipeline' && !stagesLoaded) ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
              <p className="text-[var(--v2-text-secondary)] font-medium">{t('crm.loading')}</p>
            </div>
          </div>
        ) : (
          <>
            {viewMode === 'pipeline' && !pipelineStages.length && stagesFailed && (
              <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center space-y-3 max-w-md">
                  <p className="text-[var(--v2-text-primary)] font-medium">{t('crm.stages_failed_title')}</p>
                  <p className="text-sm text-[var(--v2-text-secondary)]">{t('crm.stages_failed_body')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      // Back behind the spinner until the board has its rows.
                      // The fetch effect re-runs on `stagesLoaded` and fetchBoard
                      // clears `loading` either way — rows or no stages.
                      // Raising `loading` too stops a one-frame empty board
                      // between the stages arriving and fetchBoard starting.
                      setLoading(true);
                      setStagesLoaded(false);
                      void fetchPipelineStages();
                    }}
                    className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-surface-hover)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {t('crm.stages_failed_retry')}
                  </button>
                </div>
              </div>
            )}
            {viewMode === 'pipeline' && !pipelineStages.length && !stagesFailed && (
              <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center space-y-2 max-w-md">
                  <p className="text-[var(--v2-text-primary)] font-medium">{t('crm.no_stages_title')}</p>
                  <p className="text-sm text-[var(--v2-text-secondary)]">{t('crm.no_stages_body')}</p>
                </div>
              </div>
            )}
            {viewMode === 'pipeline' && pipelineStages.length > 0 && (
              <>
                <CRMPipelineView
                  contacts={contacts}
                  stages={pipelineStages}
                  stageTotals={stageTotals}
                  onLoadMore={loadMoreStage}
                  onContactClick={handleContactClick}
                  onContactUpdated={() => fetchBoard(true)}
                />
                {/*
                  No global pager here: the board pages COLUMN BY COLUMN.

                  One page across the whole board spread twenty contacts over
                  four columns, so a stage holding sixty showed a handful and
                  read as nearly empty. Each column now loads its own twenty and
                  offers more when it has more.
                */}
              </>
            )}
            {viewMode === 'contacts' && (
              <CRMContactList
                contacts={paginatedContacts}
                stages={pipelineStages}
                onContactClick={handleContactClick}
                onContactsUpdated={() => {
                  /*
                   * Silent: the bulk actions behind this already show their own
                   * `bulkLoading` state, so the full-page spinner was a second
                   * indicator for the same work, and it threw away the list the
                   * owner was looking at to redraw the same rows.
                   */
                  void fetchContacts(true);
                }}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            )}
            {viewMode === 'subscribers' && (
              /*
                Subscribers are not contacts, so this list fetches its own data
                rather than filtering the contacts already in memory. Promoting
                one creates a contact, which is why the pipeline is refreshed.
              */
              <CRMSubscriberList onPromoted={() => fetchContacts(true)} />
            )}
            {viewMode === 'tasks' && (
              <CRMTaskList
                key={taskListKey}
                onContactClick={handleContactClickFromTaskList}
                onTaskClick={(task) => setTaskToEdit(task)}
                onTasksUpdated={() => setTaskListKey(prev => prev + 1)}
                searchQuery={searchQuery}
              />
            )}
          </>
        )}
      </div>

      {/* Contact Edit Drawer */}
      {selectedContact && (
        <CRMContactDrawerV2
          contact={selectedContact}
          stages={pipelineStages}
          enabledCapabilities={enabledCapabilities}
          isOpen={true}
          onClose={() => {
            setSelectedContact(null);
            setDrawerDefaultTab(undefined); // Reset default tab when closing
            // Cleared with it: reopening the same contact by hand should not
            // silently expand a booking the owner never asked about.
            setDrawerFocusBookingId(undefined);
          }}
          onContactUpdated={handleContactUpdated}
          onTasksUpdated={() => setTaskListKey(prev => prev + 1)}
          initialSection={drawerDefaultTab || 'details'}
          focusBookingId={drawerFocusBookingId}
        />
      )}

      {/* New Contact Modal */}
      {isNewContactModalOpen && (
        <CRMContactModal
          stages={pipelineStages}
          isOpen={true}
          onClose={() => setIsNewContactModalOpen(false)}
          onContactUpdated={handleContactCreated}
        />
      )}

      {/* New/Edit Task Modal */}
      <CRMTaskModal
        isOpen={isNewTaskModalOpen || !!taskToEdit}
        onClose={() => {
          setIsNewTaskModalOpen(false);
          setTaskToEdit(null);
        }}
        onTaskCreated={() => {
          setTaskListKey(prev => prev + 1); // Refresh task list
          setTaskToEdit(null);
        }}
        taskToEdit={taskToEdit}
      />
    </div>
  );
}
