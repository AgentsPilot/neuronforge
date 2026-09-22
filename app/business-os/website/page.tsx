'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { intakeReachesClient } from '@/lib/business-os/intakeReach';
import { wantsWebsite } from '@/lib/business-os/onlinePresence';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Globe, Layout, Settings, Eye, EyeOff, Palette, ExternalLink, Copy, Check, Loader2, Rocket, PenLine, LayoutTemplate, RefreshCw, Plus, FileText, Trash2, X, Target, List, Megaphone, MessageCircle, Mail, DollarSign, HelpCircle, User, Sparkles, Calendar, CreditCard, Users, RotateCcw, Image as ImageIcon, Newspaper, Video, BarChart3, Package, ChevronDown, ChevronUp, Save, Wand2, Link2, Brain, Dumbbell, Hand, Flower2, Camera, Scale, Code, BookOpen, Music, Scissors, Heart, Briefcase, GraduationCap, Stethoscope, Calculator, PenTool, Mic, Utensils, Wrench, Car, Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, TrendingUp, ShoppingCart, Apple, Star, Building, GripVertical, ArrowRight, type LucideIcon } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { createLogger } from '@/lib/logger';
import { ClientJourneyStrip } from '@/components/business-os/setup/ClientJourneyStrip';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WebsitePage, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import type { WebsiteBlock, BlockType } from '@/lib/repositories/WebsiteBlockRepository';
import type { FlowStepKey } from '@/lib/business-os/clientJourney';
import { TestimonialEditor } from '@/components/website/TestimonialEditor';
import { ProcessStepEditor } from '@/components/website/ProcessStepEditor';
import type { TestimonialItem, ProcessStep } from '@/components/website/blocks/types';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
import { MediaUploader } from '@/components/website/MediaUploader';
import { FontPicker } from '@/components/website/FontPicker';
import { Switch } from '@/components/ui/switch';
import { HEADING_FONTS, BODY_FONTS, carriesHebrew } from '@/lib/website-builder/fontCatalogue';
import { openingHoursRows } from '@/lib/branding/openingHours';
import { onlinePresenceGuidance } from '@/lib/business-os/onlinePresenceGuidance';
import { WebsiteSetupWizard, type WizardResult } from '@/components/business-os/WebsiteSetupWizard';
import { LandingPageWizard, type LandingPageWizardResult } from '@/components/business-os/LandingPageWizard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';
import { getTranslatedTemplateName, getTranslatedVertical, getTranslatedBrandVoice } from '@/lib/website-builder/templateLabels';
import { ShareMenu } from '@/components/business-os/ShareMenu';
import { ShareGuide } from '@/components/business-os/ShareGuide';

const logger = createLogger({ module: 'WebsitePage' });

/**
 * Start a request now, deal with the answer later.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Loading this page was eight network legs deep, and only two of them were real
 * dependencies — the profile decides the templates URL, and the page list
 * decides which page's blocks to ask for. The other five ran one after another
 * because that is the order the lines happened to be written in: the analytics,
 * each landing page's activity, the business template, the web address and the
 * smart links all wait for each other while needing nothing from each other.
 *
 * Depth is what matters under load. Every leg is a serverless function holding
 * a database connection, so a page that takes eight round trips holds those
 * resources roughly eight times longer than one that takes three. With a
 * hundred people opening it at once, that difference is the connection pool.
 *
 * The fix is NOT to `Promise.all` the whole tail, and that distinction matters:
 * `setSubdomain` is called three times on purpose — from the company name, then
 * from the homepage, then from the address endpoint — and the last write wins.
 * Racing them would let the wrong address land in Settings, which is the exact
 * bug the comment further down was written to fix.
 *
 * So: fire the request as early as its inputs allow, then `await` it and set
 * state at the ORIGINAL line. Same order of writes, same final state, same
 * `logger.warn` on the same failure — just without the waiting in between.
 *
 * Settled rather than thrown, because a promise started early and awaited late
 * would otherwise be an unhandled rejection in the window between the two.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function startFetch<T>(url: string): Promise<Settled<T>> {
  return fetch(url)
    .then(response => response.json())
    .then(
      (value: T) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
}

/** Unwrap a `startFetch` result, re-throwing so the caller's own catch sees it. */
function settled<T>(result: Settled<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

// Lucide icon registry for services
const SERVICE_ICON_REGISTRY: Record<string, LucideIcon> = {
  MessageCircle, Brain, Target, Dumbbell, Hand, Flower2,
  Camera, Scale, Palette, Code, BookOpen, Music, Scissors,
  Sparkles, Heart, Users, Briefcase, GraduationCap, Stethoscope,
  Calculator, PenTool, Mic, Video, Utensils, Wrench, Car,
  Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, TrendingUp,
  ShoppingCart, Apple, FileText, DollarSign, Megaphone
};

// Helper to render service icon (Lucide or fallback)
function ServiceIconRenderer({ icon, className = "w-5 h-5 text-[#4F6EF7]" }: { icon?: string; className?: string }) {
  if (icon && icon in SERVICE_ICON_REGISTRY) {
    const IconComponent = SERVICE_ICON_REGISTRY[icon];
    return <IconComponent className={className} />;
  }
  // Fallback to Sparkles for unknown icons
  return <Sparkles className={className} />;
}

// Sortable block item wrapper for drag-and-drop
function SortableBlockItem({ id, children }: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto' as const
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="relative group">
        {/* Drag handle */}
        <button
          {...listeners}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}


// Website theme color: Blue (matching CRM's purple pattern)
const WEBSITE_COLOR = '#4F6EF7';

type ViewMode = 'overview' | 'journey' | 'sections' | 'design' | 'settings' | 'templates' | 'wizard';

/**
 * A smart link row, as `/api/smart-links` returns it.
 *
 * Lifted out of the `useState` generic it used to live in so the fetch that
 * loads these can be typed without restating the shape.
 */
/** The ten figures `/api/website/analytics` returns for a page. */
interface WebsiteAnalytics {
  total_views: number;
  unique_visitors: number;
  views_today: number;
  visitors_today: number;
  views_this_month: number;
  visitors_this_month: number;
  views_30d: number;
  visitors_30d: number;
  views_7d: number;
  visitors_7d: number;
}

interface SmartLink {
  id: string;
  code: string;
  name: string | null;
  destination_url: string;
  destination_type: string | null;
  click_count: number;
  conversion_count: number;
  /** Distinct visitors, counted by the list route the way the website counts
   *  them: clicks with no identifier collapse into one unknown visitor. */
  unique_visitors?: number;
  is_active: boolean;
  created_at: string;
  metadata?: {
    journeyType?: 'contact-only' | 'full';
    serviceIds?: string[];
    flow?: string[];
    destinationType?: 'form' | 'booking';
  } | null;
}

interface WebsiteTemplate {
  id: string;
  name: string;
  description?: string;
  vertical: string;
  keywords?: string[];
  preview_url?: string;
  thumbnail_url?: string;
  template_type?: string;
  theme: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    font_family?: string;
    brand_voice?: string;
    // Also support PageTheme structure
    colors?: PageTheme['colors'];
    fonts?: PageTheme['fonts'];
  };
  blocks: Array<{ block_type: string; position: number; type?: string }>;
}

/** A row from /api/website/blocks/services, as the wizard rewrites it. */
interface PublicServiceRow {
  id: string;
  name: string;
  description?: string;
  price?: string;
  priceRaw?: number;
  duration?: string;
  durationMinutes?: number;
  icon?: string;
  is_scheduled: boolean;
  collection: 'online' | 'invoice' | null;
}

interface BusinessProfile {
  id: string;
  user_id: string;
  company_name: string | null;
  vertical: string;
  sub_vertical: string | null;
  user_code?: string;
  /** The business's logo. Owned by the profile; pages only choose to show it. */
  logo_url?: string | null;
  /** What the onboarding chat agreed: see wantsWebsite(). */
  online_presence_mode?: string | null;
  /**
   * The business in its own words, from the onboarding chat.
   *
   * Sent to the templates endpoint so the recommendation can read prose as well
   * as the coarse vertical label. It is also the single best piece of context
   * the copywriting prompt gets.
   */
  description?: string | null;
  /**
   * When this business works — the one place it says so.
   *
   * The same column the booking calendar runs on. The editor reads it to show
   * the opening hours the footer and contact section will publish, so nobody
   * has to guess what a visitor will be told.
   */
  scheduling_availability?: Record<string, Array<{ start: string; end: string }>> | null;
}

// Localized strings
const LABELS = {
  en: {
    /*
     * "Online presence", not "Website".
     *
     * This screen has not been about one website for a long time: it holds the
     * site, the landing pages and the smart links, and a business reaching
     * clients by link alone has no website here at all. Calling it Website told
     * that owner the page was not for them — and "Overview" named a summary the
     * tab has never been. It is the page you come back to.
     */
    title: 'Online presence',
    subtitle: 'Your website, landing pages and smart links, in one place',
    tab_overview: 'Online presence',
    landing_page_failed: 'We could not create that landing page. Nothing was saved — try again.',
    landing_page_creating: 'Building your landing page…',
    font_latin_only: 'Latin only',
    journey_no_services: 'No services on this page yet, so there is no journey to show.',
    journey_edit_in_services: 'Change a journey by editing its service →',
    delete_website_title: 'Delete this website',
    delete_website_body: 'Removes the site, every section, and the text you wrote for it. If it is published it goes offline immediately. This cannot be undone.',
    delete_website_action: 'Delete website',
    delete_website_confirm_title: 'Delete this website?',
    delete_website_confirm_body: 'The site, its sections and all the copy you wrote will be permanently removed. Your services, bookings and clients are not affected.',
    delete_website_confirm_live: 'This site is live. Visitors will stop being able to reach it as soon as you confirm.',
    delete_website_confirm_action: 'Yes, delete it',
    delete_website_failed: 'We could not delete the website. Nothing was changed — try again.',
    toggle_section_failed: 'We could not change that section. It has been put back the way it was — try again.',
    publish_landing: 'Publish',
    unpublish_landing: 'Unpublish',
    publish_landing_title: 'Publish this landing page',
    publish_landing_url: 'Public address',
    publish_landing_url_hint: 'This is the address clients will open. You can change it now.',
    publish_landing_failed: 'We could not publish the page. Nothing was changed — try again.',
    publish_landing_needs_address: 'Choose the address your pages will be published under.',
    template_change_failed: 'We could not change the template. Nothing was changed — try again.',
    template_unselect: 'Click to unselect this template',
    template_in_use: 'This template is in use. Delete the website and landing pages built from it before unselecting.',
    generation_failed: 'We could not write your site just now. The sections below are placeholders you can edit, or try again.',
    generation_degraded: 'Your site was built, but some of the writing fell back to standard text. Worth a read before publishing.',
    /*
     * The website area's AI is switched off by the platform operator
     * (Layer 2 FR-14). Not an error: nothing failed and nothing was
     * overwritten, and trying again will not help until it is switched back
     * on. The same sentence serves all three AI-writing surfaces on this
     * page, and matches AI_UNAVAILABLE_WEBSITE_WRITING on the server.
     */
    ai_unavailable: 'AI writing is unavailable right now.',
    tab_journey: 'Client Journey',
    tab_sections: 'Sections',
    tab_design: 'Design',
    tab_settings: 'Settings',
    settings_needs_page: 'You have no web address yet. Publish a landing page or create a website, and it will appear here.',
    settings_address_label: 'Your web address',
    settings_address_hint: 'Every page and link you publish is served from this address. Creating a website will use it too.',
    tab_templates: 'Templates',
    status_draft: 'Draft',
    status_live: 'Live',
    status_inactive: 'Inactive',
    type_landing_page: 'Landing Page',
    type_contact_link: 'Contact Smart Link',
    type_services_link: 'Services Smart Link',
    type_payment_link: 'Payment Smart Link',
    type_smart_link: 'Smart Link',
    status_coming_soon: 'Coming Soon',
    publish: 'Publish',
    unpublish: 'Unpublish',
    publish_failed: 'Could not publish the website.',
    unpublish_failed: 'Could not unpublish the website.',
    publish_fix_availability: 'Set working hours',
    publish_fix_invoicing: 'Complete invoice details',
    publishing: 'Publishing...',
    view_site: 'View Site',
    copy_link: 'Copy Link',
    link_copied: 'Link Copied!',
    no_website: 'No Website Yet',
    no_website_desc: 'Click “Create Website” above to build your professional site.',
    choose_template: 'Choose a Template',
    loading: 'Loading...',
    preview: 'Preview',
    edit_content: 'Edit Content',
    run_setup_wizard: 'Run Setup Wizard',
    subdomain: 'Subdomain',
    subdomain_desc: 'Your website will be available at',
    subdomain_taken: 'This subdomain is already taken',
    checking: 'Checking…',
    publish_address_title: 'Choose your web address',
    publish_address_subtitle: 'This is the address clients will see. You can change it now — afterwards it is what you will have shared.',
    subdomain_available: 'Available',
    save_changes: 'Save Changes',
    saving: 'Saving...',
    sections_title: 'Website Sections',
    sections_desc: 'Toggle sections on/off and drag to reorder',
    design_title: 'Design & Theme',
    design_desc: 'Customize colors, fonts, and styling',
    settings_title: 'Website Settings',
    settings_desc: 'Configure subdomain and SEO settings',
    visitors_today: 'Today',
    visitors_7d: 'Last 7 Days',
    visitors_30d: 'Last 30 Days',
    total_views: 'Total Views',
    unique_visitors: 'Unique Visitors',
    page_views: 'Analytics',
    journey_title: 'Client Journey',
    journey_desc: 'What each service puts your clients through. Set on the service itself — this is where you see it.',
    journey_step_scheduling: 'Schedule Appointment',
    journey_step_scheduling_desc: 'Client selects date and time',
    journey_step_client_info: 'Client Information',
    journey_step_client_info_desc: 'Collect name, email, and phone',
    journey_step_booking: 'Book Appointment',
    journey_step_booking_desc: 'Client selects date, time, and enters info',
    journey_step_payment: 'Collect Payment',
    journey_step_payment_desc: 'Secure payment before appointment',
    journey_step_intake: 'Intake Form',
    journey_step_intake_desc: 'Gather additional client information',
    journey_step_confirmation: 'Confirmation',
    journey_step_confirmation_desc: 'Client receives confirmation email',
    journey_add_step: 'Add Step',
    journey_save: 'Save section',
    journey_saving: 'Saving...',
    journey_always_included: 'Always included',
    journey_services_only: 'Show services without booking flow',
    journey_services_only_desc: 'Display your services as information only - no booking or payment',
    journey_services_only_info: 'Your services will be displayed without a booking flow.',
    journey_services_only_info2: "Clients can view your offerings but won't be able to book directly.",
    primary_color: 'Primary Color',
    font_heading: 'Heading Font',
    font_body: 'Body Font',
    meta_title: 'Page Title',
    meta_description: 'Meta Description',
    seo_keywords: 'SEO Keywords',
    templates_title: 'Change Template',
    templates_desc: 'Select a different template to change your website colors and fonts.',
    current_template: 'Current Template',
    apply_template: 'Apply Template',
    applying_template: 'Applying...',
    template_warning: 'Your content will be preserved. Only colors and fonts will change.',
    create_website: 'Create Website',
    tab_pages: 'Pages',
    pages_title: 'Website Pages',
    pages_desc: 'Manage your homepage and landing pages',
    add_landing_page: 'Add Landing Page',
    homepage: 'Homepage',
    landing_page: 'Landing Page',
    page_title_placeholder: 'e.g., ADHD Coaching Course',
    page_slug_placeholder: 'e.g., adhd-course',
    create_page: 'Create Page',
    creating_page: 'Creating...',
    cancel: 'Cancel',
    delete_page: 'Delete',
    delete_page_title: 'Delete Page',
    delete_page_confirm: 'Are you sure you want to delete this page?',
    delete_page_has_activity: 'This page has activity ({count} views). Are you sure you want to delete it?',
    delete_page_deactivate: 'It will be deleted permanently and cannot be recovered. To take it offline instead, use Unpublish.',
    delete_confirm: 'Delete',
    delete_deactivate: 'Deactivate',
    edit_page: 'Edit',
    page_slug: 'URL Slug',
    edit_block: 'Edit Content',
    save_block: 'Save',
    headline: 'Headline',
    subheadline: 'Subheadline',
    cta_text: 'Button Text',
    cta_link: 'Button Link',
    section_title: 'Section Title',
    section_subtitle: 'Section Subtitle',
    about_text: 'About Text',
    video_url: 'Video URL',
    sync_business_data: 'Sync with Business Data',
    syncing: 'Syncing...',
    sync_success: 'Synced! {count} sections updated',
    sync_no_data: 'No business data to sync',
    generate_with_ai: 'Generate with AI',
    generating: 'Generating...',
    writing_title: 'Writing your website',
    writing_body: 'From your business name, description and services. This takes a few moments.',
    hero_image: 'Hero Image',
    upload_image: 'Upload Image',
    image_url: 'Image URL',
    section_image: 'Section Image',
    services_synced: 'Services synced from Scheduling',
    stats_synced: 'Stats calculated from your data',
    no_services_hint: 'Add services in the Scheduling capability to populate this section',
    edit_services: 'Edit individual services in Scheduling',
    refresh_services: 'Refresh from Scheduling',
    services_count: '{count} services from your Scheduling',
    position: 'Position',
    generated_from_business: 'Generated from business name',
    main_website: 'Main Website',
    main_website_desc: 'Your full business website',
    design_colors: 'Design & Colors',
    run_wizard: 'Run Setup Wizard',
    create_landing_page: 'Create New',
    landing_pages: 'Customer Acquisition',
    landing_pages_desc: 'Smart links and landing pages for lead capture',
    no_landing_pages: 'No landing pages yet',
    no_landing_pages_desc: 'Create landing pages to promote specific services',
    journey_booking: 'Booking',
    journey_direct_sale: 'Direct Sale',
    journey_full_flow: 'Full Flow',
    journey_lead_capture: 'Lead Capture'
  },
  es: {
    title: 'Presencia online',
    subtitle: 'Tu sitio web, landing pages y smart links, en un solo lugar',
    tab_overview: 'Presencia online',
    landing_page_failed: 'No pudimos crear esa landing page. No se guardó nada — inténtalo de nuevo.',
    landing_page_creating: 'Creando tu landing page…',
    font_latin_only: 'Solo latino',
    journey_no_services: 'Aún no hay servicios en esta página, así que no hay recorrido que mostrar.',
    journey_edit_in_services: 'Cambia un recorrido editando su servicio →',
    delete_website_title: 'Eliminar este sitio',
    delete_website_body: 'Elimina el sitio, todas sus secciones y el texto que escribiste. Si está publicado, dejará de estar disponible de inmediato. No se puede deshacer.',
    delete_website_action: 'Eliminar sitio',
    delete_website_confirm_title: '¿Eliminar este sitio?',
    delete_website_confirm_body: 'El sitio, sus secciones y todo el texto que escribiste se eliminarán definitivamente. Tus servicios, reservas y clientes no se ven afectados.',
    delete_website_confirm_live: 'Este sitio está publicado. Dejará de ser accesible en cuanto confirmes.',
    delete_website_confirm_action: 'Sí, eliminarlo',
    delete_website_failed: 'No pudimos eliminar el sitio. No se cambió nada — inténtalo de nuevo.',
    toggle_section_failed: 'No pudimos cambiar esa sección. Se restauró como estaba — inténtalo de nuevo.',
    publish_landing: 'Publicar',
    unpublish_landing: 'Despublicar',
    publish_landing_title: 'Publicar esta página de destino',
    publish_landing_url: 'Dirección pública',
    publish_landing_url_hint: 'Esta es la dirección que abrirán tus clientes. Puedes cambiarla ahora.',
    publish_landing_failed: 'No pudimos publicar la página. No se cambió nada — inténtalo de nuevo.',
    publish_landing_needs_address: 'Elige la dirección bajo la que se publicarán tus páginas.',
    template_change_failed: 'No pudimos cambiar la plantilla. No se cambió nada — inténtalo de nuevo.',
    template_unselect: 'Haz clic para deseleccionar esta plantilla',
    template_in_use: 'Esta plantilla está en uso. Elimina el sitio y las páginas de destino creadas con ella antes de deseleccionarla.',
    generation_failed: 'No pudimos redactar tu sitio ahora. Las secciones de abajo son textos de ejemplo que puedes editar, o inténtalo de nuevo.',
    generation_degraded: 'Tu sitio se creó, pero parte del texto es genérico. Conviene revisarlo antes de publicar.',
    ai_unavailable: 'La redacción con IA no está disponible en este momento.',
    tab_journey: 'Recorrido del Cliente',
    tab_sections: 'Secciones',
    tab_design: 'Diseño',
    tab_settings: 'Configuración',
    settings_needs_page: 'Aún no tienes dirección web. Publica una página de destino o crea un sitio y aparecerá aquí.',
    settings_address_label: 'Tu dirección web',
    settings_address_hint: 'Cada página y enlace que publiques se sirve desde esta dirección. Un sitio web también la usará.',
    tab_templates: 'Plantillas',
    status_draft: 'Borrador',
    status_live: 'Publicado',
    status_inactive: 'Inactivo',
    type_landing_page: 'Página de Destino',
    type_contact_link: 'Enlace de Contacto',
    type_services_link: 'Enlace de Servicios',
    type_payment_link: 'Enlace de Pago',
    type_smart_link: 'Enlace Inteligente',
    status_coming_soon: 'Próximamente',
    publish: 'Publicar',
    unpublish: 'Despublicar',
    publish_failed: 'No se pudo publicar el sitio.',
    unpublish_failed: 'No se pudo despublicar el sitio.',
    publish_fix_availability: 'Configurar horario',
    publish_fix_invoicing: 'Completar datos de factura',
    publishing: 'Publicando...',
    view_site: 'Ver Sitio',
    copy_link: 'Copiar Enlace',
    link_copied: '¡Enlace Copiado!',
    no_website: 'Sin Sitio Web',
    no_website_desc: 'Pulsa “Crear Sitio Web” arriba para crear tu sitio profesional.',
    choose_template: 'Elegir Plantilla',
    loading: 'Cargando...',
    preview: 'Vista Previa',
    edit_content: 'Editar Contenido',
    run_setup_wizard: 'Ejecutar Asistente',
    subdomain: 'Subdominio',
    subdomain_desc: 'Tu sitio web estará disponible en',
    subdomain_taken: 'Este subdominio ya está ocupado',
    checking: 'Comprobando…',
    publish_address_title: 'Elige tu dirección web',
    publish_address_subtitle: 'Esta es la dirección que verán tus clientes. Puedes cambiarla ahora — después será la que ya hayas compartido.',
    subdomain_available: 'Disponible',
    save_changes: 'Guardar Cambios',
    saving: 'Guardando...',
    sections_title: 'Secciones del Sitio',
    sections_desc: 'Activa/desactiva secciones y arrastra para reordenar',
    design_title: 'Diseño y Tema',
    design_desc: 'Personaliza colores, fuentes y estilo',
    settings_title: 'Configuración del Sitio',
    settings_desc: 'Configura subdominio y SEO',
    visitors_today: 'Hoy',
    visitors_7d: 'Últimos 7 Días',
    visitors_30d: 'Últimos 30 Días',
    total_views: 'Visitas Totales',
    unique_visitors: 'Visitantes Únicos',
    page_views: 'Analíticas',
    journey_title: 'Recorrido del Cliente',
    journey_desc: 'Lo que cada servicio hace pasar a tus clientes. Se define en el servicio; aquí lo ves.',
    journey_step_scheduling: 'Programar Cita',
    journey_step_scheduling_desc: 'El cliente selecciona fecha y hora',
    journey_step_client_info: 'Información del Cliente',
    journey_step_client_info_desc: 'Recopilar nombre, email y teléfono',
    journey_step_booking: 'Reservar Cita',
    journey_step_booking_desc: 'El cliente selecciona fecha, hora e ingresa info',
    journey_step_payment: 'Cobrar Pago',
    journey_step_payment_desc: 'Pago seguro antes de la cita',
    journey_step_intake: 'Formulario de Ingreso',
    journey_step_intake_desc: 'Recopilar información adicional del cliente',
    journey_step_confirmation: 'Confirmación',
    journey_step_confirmation_desc: 'El cliente recibe email de confirmación',
    journey_add_step: 'Agregar Paso',
    journey_save: 'Guardar sección',
    journey_saving: 'Guardando...',
    journey_always_included: 'Siempre incluido',
    journey_services_only: 'Mostrar servicios sin flujo de reserva',
    journey_services_only_desc: 'Muestra tus servicios solo como información - sin reserva ni pago',
    journey_services_only_info: 'Tus servicios se mostrarán sin flujo de reserva.',
    journey_services_only_info2: 'Los clientes pueden ver tus ofertas pero no podrán reservar directamente.',
    primary_color: 'Color Principal',
    font_heading: 'Fuente de Títulos',
    font_body: 'Fuente de Texto',
    meta_title: 'Título de Página',
    meta_description: 'Meta Descripción',
    seo_keywords: 'Palabras Clave SEO',
    templates_title: 'Cambiar Plantilla',
    templates_desc: 'Selecciona una plantilla para cambiar los colores y fuentes de tu sitio.',
    current_template: 'Plantilla Actual',
    apply_template: 'Aplicar Plantilla',
    applying_template: 'Aplicando...',
    template_warning: 'Tu contenido se conservará. Solo cambiarán los colores y fuentes.',
    create_website: 'Crear Sitio Web',
    tab_pages: 'Páginas',
    pages_title: 'Páginas del Sitio',
    pages_desc: 'Administra tu página principal y páginas de destino',
    add_landing_page: 'Agregar Página',
    homepage: 'Página Principal',
    landing_page: 'Página de Destino',
    page_title_placeholder: 'ej., Curso de Coaching TDAH',
    page_slug_placeholder: 'ej., curso-tdah',
    create_page: 'Crear Página',
    creating_page: 'Creando...',
    cancel: 'Cancelar',
    delete_page: 'Eliminar',
    delete_page_title: 'Eliminar Página',
    delete_page_confirm: '¿Estás seguro de que quieres eliminar esta página?',
    delete_page_has_activity: 'Esta página tiene actividad ({count} visitas). ¿Estás seguro de que quieres eliminarla?',
    delete_page_deactivate: 'Se eliminará permanentemente y no se podrá recuperar. Para retirarla sin borrarla, usa Despublicar.',
    delete_confirm: 'Eliminar',
    delete_deactivate: 'Desactivar',
    edit_page: 'Editar',
    page_slug: 'URL Slug',
    edit_block: 'Editar Contenido',
    save_block: 'Guardar',
    headline: 'Titular',
    subheadline: 'Subtítulo',
    cta_text: 'Texto del Botón',
    cta_link: 'Enlace del Botón',
    section_title: 'Título de Sección',
    section_subtitle: 'Subtítulo de Sección',
    about_text: 'Texto Sobre Nosotros',
    video_url: 'URL del Video',
    sync_business_data: 'Sincronizar con Datos de Negocio',
    syncing: 'Sincronizando...',
    sync_success: '¡Sincronizado! {count} secciones actualizadas',
    sync_no_data: 'No hay datos de negocio para sincronizar',
    generate_with_ai: 'Generar con IA',
    generating: 'Generando...',
    writing_title: 'Escribiendo tu sitio web',
    writing_body: 'Con el nombre, la descripción y los servicios de tu negocio. Tardará unos momentos.',
    hero_image: 'Imagen Principal',
    upload_image: 'Subir Imagen',
    image_url: 'URL de Imagen',
    section_image: 'Imagen de Sección',
    services_synced: 'Servicios sincronizados desde Programación',
    stats_synced: 'Estadísticas calculadas desde tus datos',
    no_services_hint: 'Agrega servicios en Programación para completar esta sección',
    edit_services: 'Edita servicios individuales en Programación',
    refresh_services: 'Actualizar desde Programación',
    services_count: '{count} servicios desde Programación',
    position: 'Posición',
    generated_from_business: 'Generado del nombre del negocio',
    main_website: 'Sitio Web Principal',
    main_website_desc: 'Tu sitio web completo de negocios',
    design_colors: 'Diseño y Colores',
    run_wizard: 'Ejecutar Asistente',
    create_landing_page: 'Crear Nuevo',
    landing_pages: 'Adquisición de Clientes',
    landing_pages_desc: 'Smart links y páginas de aterrizaje para captura de leads',
    no_landing_pages: 'Aún no hay páginas de destino',
    no_landing_pages_desc: 'Crea páginas de destino para promover servicios específicos',
    journey_booking: 'Reserva',
    journey_direct_sale: 'Venta Directa',
    journey_full_flow: 'Flujo Completo',
    journey_lead_capture: 'Captura de Leads'
  },
  he: {
    title: 'נוכחות דיגיטלית',
    subtitle: 'האתר, דפי הנחיתה והקישורים החכמים שלך — במקום אחד',
    tab_overview: 'נוכחות דיגיטלית',
    landing_page_failed: 'לא הצלחנו ליצור את דף הנחיתה. שום דבר לא נשמר — נסו שוב.',
    landing_page_creating: 'בונים את דף הנחיתה…',
    font_latin_only: 'ללא עברית',
    journey_no_services: 'אין עדיין שירותים בדף הזה, ולכן אין מסע להציג.',
    journey_edit_in_services: 'לשינוי מסע — ערכו את השירות שלו ←',
    delete_website_title: 'מחיקת האתר',
    delete_website_body: 'מוחק את האתר, כל הסעיפים והטקסט שכתבתם עבורו. אם האתר מפורסם הוא יירד מיד. לא ניתן לבטל.',
    delete_website_action: 'מחיקת האתר',
    delete_website_confirm_title: 'למחוק את האתר?',
    delete_website_confirm_body: 'האתר, הסעיפים שלו וכל הטקסט שכתבתם יימחקו לצמיתות. השירותים, התורים והלקוחות שלכם לא מושפעים.',
    delete_website_confirm_live: 'האתר מפורסם. מרגע האישור מבקרים לא יוכלו להגיע אליו.',
    delete_website_confirm_action: 'כן, למחוק',
    delete_website_failed: 'לא הצלחנו למחוק את האתר. שום דבר לא שונה — נסו שוב.',
    toggle_section_failed: 'לא הצלחנו לשנות את המקטע. הוא הוחזר למצבו הקודם — נסו שוב.',
    publish_landing: 'פרסום',
    unpublish_landing: 'ביטול פרסום',
    publish_landing_title: 'פרסום דף הנחיתה',
    publish_landing_url: 'כתובת ציבורית',
    publish_landing_url_hint: 'זו הכתובת שהלקוחות יפתחו. אפשר לשנות אותה עכשיו.',
    publish_landing_failed: 'לא הצלחנו לפרסם את הדף. שום דבר לא שונה — נסו שוב.',
    publish_landing_needs_address: 'בחרו את הכתובת שתחתיה יפורסמו הדפים שלכם.',
    template_change_failed: 'לא הצלחנו לשנות את התבנית. שום דבר לא שונה — נסו שוב.',
    template_unselect: 'לחצו כדי לבטל את בחירת התבנית',
    template_in_use: 'התבנית בשימוש. מחקו את האתר ואת דפי הנחיתה שנבנו ממנה לפני ביטול הבחירה.',
    generation_failed: 'לא הצלחנו לכתוב את האתר כרגע. הסעיפים למטה הם טקסט זמני שאפשר לערוך, או נסו שוב.',
    generation_degraded: 'האתר נבנה, אבל חלק מהטקסט הוא כללי. כדאי לעבור עליו לפני הפרסום.',
    ai_unavailable: 'כתיבה עם AI אינה זמינה כרגע.',
    tab_journey: 'מסע הלקוח',
    tab_sections: 'חלקים',
    tab_design: 'עיצוב',
    tab_settings: 'הגדרות',
    settings_needs_page: 'עדיין אין לכם כתובת אינטרנט. פרסמו דף נחיתה או צרו אתר, והיא תופיע כאן.',
    settings_address_label: 'הכתובת שלכם',
    settings_address_hint: 'כל דף וקישור שתפרסמו מוגשים מהכתובת הזו. גם אתר שתיצרו ישתמש בה.',
    tab_templates: 'תבניות',
    status_draft: 'טיוטה',
    status_live: 'פעיל',
    status_inactive: 'כבוי',
    type_landing_page: 'דף נחיתה',
    type_contact_link: 'קישור ליצירת קשר',
    type_services_link: 'קישור לשירותים',
    type_payment_link: 'קישור לתשלום',
    type_smart_link: 'קישור חכם',
    status_coming_soon: 'בקרוב',
    publish: 'פרסם',
    unpublish: 'הסר מפרסום',
    publish_failed: 'לא ניתן לפרסם את האתר.',
    unpublish_failed: 'לא ניתן להסיר את האתר מפרסום.',
    publish_fix_availability: 'הגדר שעות פעילות',
    publish_fix_invoicing: 'השלם פרטי חשבונית',
    publishing: '...מפרסם',
    view_site: 'צפה באתר',
    copy_link: 'העתק קישור',
    link_copied: '!קישור הועתק',
    no_website: 'עדיין אין אתר',
    no_website_desc: 'לחץ על ״צור אתר״ למעלה כדי לבנות את האתר המקצועי שלך.',
    choose_template: 'בחר תבנית',
    loading: '...טוען',
    preview: 'תצוגה מקדימה',
    edit_content: 'ערוך תוכן',
    run_setup_wizard: 'הפעל אשף הגדרות',
    subdomain: 'תת-דומיין',
    subdomain_desc: 'האתר שלך יהיה זמין ב',
    subdomain_taken: 'תת-דומיין זה כבר תפוס',
    checking: 'בודק…',
    publish_address_title: 'בחר את כתובת האתר שלך',
    publish_address_subtitle: 'זו הכתובת שהלקוחות יראו. אפשר לשנות אותה עכשיו — אחר כך זו הכתובת שכבר שיתפת.',
    subdomain_available: 'זמין',
    save_changes: 'שמור שינויים',
    saving: '...שומר',
    sections_title: 'חלקי האתר',
    sections_desc: 'הפעל/כבה חלקים וגרור לסידור מחדש',
    design_title: 'עיצוב ותבנית',
    design_desc: 'התאם אישית צבעים, גופנים ועיצוב',
    settings_title: 'הגדרות האתר',
    settings_desc: 'הגדר תת-דומיין ו-SEO',
    visitors_today: 'היום',
    visitors_7d: '7 ימים אחרונים',
    visitors_30d: '30 ימים אחרונים',
    total_views: 'סה"כ צפיות',
    unique_visitors: 'מבקרים ייחודיים',
    page_views: 'אנליטיקס',
    journey_title: 'מסע הלקוח',
    journey_desc: 'מה כל שירות מעביר את הלקוחות שלכם. נקבע בשירות עצמו — כאן רואים את זה.',
    journey_step_scheduling: 'תיאום פגישה',
    journey_step_scheduling_desc: 'הלקוח בוחר תאריך ושעה',
    journey_step_client_info: 'פרטי לקוח',
    journey_step_client_info_desc: 'איסוף שם, אימייל וטלפון',
    journey_step_booking: 'קביעת פגישה',
    journey_step_booking_desc: 'הלקוח בוחר תאריך, שעה ומזין פרטים',
    journey_step_payment: 'גביית תשלום',
    journey_step_payment_desc: 'תשלום מאובטח לפני הפגישה',
    journey_step_intake: 'טופס קליטה',
    journey_step_intake_desc: 'איסוף מידע נוסף על הלקוח',
    journey_step_confirmation: 'אישור',
    journey_step_confirmation_desc: 'הלקוח מקבל מייל אישור',
    journey_add_step: 'הוסף שלב',
    journey_save: 'שמירת הסעיף',
    journey_saving: 'שומר...',
    journey_always_included: 'תמיד כלול',
    journey_services_only: 'הצג שירותים ללא תהליך הזמנה',
    journey_services_only_desc: 'הצג את השירותים שלך כמידע בלבד - ללא הזמנה או תשלום',
    journey_services_only_info: 'השירותים שלך יוצגו ללא תהליך הזמנה.',
    journey_services_only_info2: 'לקוחות יוכלו לצפות בשירותים שלך אך לא יוכלו להזמין ישירות.',
    primary_color: 'צבע ראשי',
    font_heading: 'גופן כותרות',
    font_body: 'גופן גוף',
    meta_title: 'כותרת עמוד',
    meta_description: 'תיאור מטא',
    seo_keywords: 'מילות מפתח SEO',
    templates_title: 'החלף תבנית',
    templates_desc: 'בחר תבנית כדי לשנות את הצבעים והפונטים של האתר.',
    current_template: 'תבנית נוכחית',
    apply_template: 'החל תבנית',
    applying_template: '...מחיל',
    template_warning: 'התוכן שלך יישמר. רק הצבעים והפונטים ישתנו.',
    create_website: 'צור אתר',
    tab_pages: 'דפים',
    pages_title: 'דפי האתר',
    pages_desc: 'נהל את דף הבית ודפי הנחיתה שלך',
    add_landing_page: 'הוסף דף נחיתה',
    homepage: 'דף הבית',
    landing_page: 'דף נחיתה',
    page_title_placeholder: 'לדוגמה: קורס אימון ADHD',
    page_slug_placeholder: 'לדוגמה: adhd-course',
    create_page: 'צור דף',
    creating_page: '...יוצר',
    cancel: 'ביטול',
    delete_page: 'מחק',
    delete_page_title: 'מחיקת דף',
    delete_page_confirm: 'האם אתה בטוח שברצונך למחוק דף זה?',
    delete_page_has_activity: 'לדף זה יש פעילות ({count} צפיות). האם אתה בטוח שברצונך למחוק אותו?',
    delete_page_deactivate: 'הוא יימחק לצמיתות ולא ניתן יהיה לשחזר אותו. כדי להוריד אותו מהאוויר בלבד, השתמשו בביטול פרסום.',
    delete_confirm: 'מחק',
    delete_deactivate: 'השבת',
    edit_page: 'ערוך',
    page_slug: 'כתובת URL',
    edit_block: 'ערוך תוכן',
    save_block: 'שמור',
    headline: 'כותרת ראשית',
    subheadline: 'כותרת משנה',
    cta_text: 'טקסט כפתור',
    cta_link: 'קישור כפתור',
    section_title: 'כותרת חלק',
    section_subtitle: 'תת-כותרת חלק',
    about_text: 'טקסט אודות',
    video_url: 'כתובת וידאו',
    sync_business_data: 'סנכרן עם נתוני העסק',
    syncing: '...מסנכרן',
    sync_success: 'סונכרן! {count} חלקים עודכנו',
    sync_no_data: 'אין נתוני עסק לסנכרון',
    generate_with_ai: 'צור עם AI',
    generating: '...יוצר',
    writing_title: 'כותבים את האתר שלך',
    writing_body: 'לפי שם העסק, התיאור והשירותים שלך. זה ייקח כמה רגעים.',
    hero_image: 'תמונה ראשית',
    upload_image: 'העלה תמונה',
    image_url: 'כתובת תמונה',
    section_image: 'תמונת חלק',
    services_synced: 'שירותים סונכרנו מהתיאום',
    stats_synced: 'סטטיסטיקות מחושבות מהנתונים שלך',
    no_services_hint: 'הוסף שירותים ביכולת התיאום כדי למלא חלק זה',
    edit_services: 'ערוך שירותים בודדים בתיאום',
    refresh_services: 'רענן מהתיאום',
    services_count: '{count} שירותים מהתיאום שלך',
    position: 'מיקום',
    generated_from_business: 'נוצר משם העסק',
    main_website: 'אתר ראשי',
    main_website_desc: 'האתר העסקי המלא שלך',
    design_colors: 'עיצוב וצבעים',
    run_wizard: 'הפעל אשף',
    create_landing_page: 'צור חדש',
    landing_pages: 'גיוס לקוחות',
    landing_pages_desc: 'קישורים חכמים ודפי נחיתה לגיוס לידים',
    no_landing_pages: 'עדיין אין דפי נחיתה',
    no_landing_pages_desc: 'צור דפי נחיתה לקידום שירותים ספציפיים',
    journey_booking: 'הזמנה',
    journey_direct_sale: 'מכירה ישירה',
    journey_full_flow: 'תהליך מלא',
    journey_lead_capture: 'איסוף לידים'
  }
};

// Template name translations

export default function WebsiteManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `t` as well as `language`: the guidance and the publish warning are keyed
  // strings in three languages, not the inline ternaries the rest of this file
  // uses for one-off labels.
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const labels = LABELS[language] || LABELS.en;

  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [page, setPage] = useState<WebsitePage | null>(null);
  const wizardPageRef = useRef<WebsitePage | null>(null);
  const [generating, setGenerating] = useState(false);
  /**
   * Something the person needs to be told about the last generation.
   *
   * Failures used to be logged and swallowed — the wizard carried on to the
   * preview and the business saw a finished-looking site made of English
   * placeholders, with nothing anywhere saying the writing had not happened.
   */
  const [generationNotice, setGenerationNotice] = useState<{ kind: 'error' | 'warning' | 'progress'; message: string } | null>(null);
  /**
   * Why the last publish or unpublish was refused.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Its own state, rendered on the website card, because the two notices that
   * already exist appear somewhere else: `saveMessage` renders in the design
   * panel and the block editor's save bar, and `generationNotice` sits above
   * the page header. The Publish button is on the card, and the answer to a
   * click belongs where the click was.
   *
   * Before this the handler had no else branch at all — a 400 was parsed,
   * discarded, and the button simply stopped spinning, while the server had
   * already worked out which services were holding it up and said so.
   */
  const [publishError, setPublishError] = useState<string | null>(null);
  /**
   * The address dialog shown before a website goes live.
   *
   * The prefix is generated — `3k1ila.agentpilot.io` — and publishing put that
   * on the internet without ever showing it to the owner. It is the address
   * they will print, send and be found at, and the one moment they are certain
   * to care about it is the moment before it becomes real.
   *
   * Only for the FIRST publish of a site. Re-publishing an address that is
   * already in use is not the time to invite a change: the old one is already
   * written down somewhere.
   */
  const [publishAddressOpen, setPublishAddressOpen] = useState(false);
  const [publishAddressValue, setPublishAddressValue] = useState('');
  /*
   * Which blocker it was, so the link beneath the message goes somewhere that
   * can fix it.
   *
   * Two things stop a publish now — no working hours, and a service that will
   * be invoiced with no invoice details behind it — and they are fixed on
   * different tabs. A single hardcoded link sent half of those businesses to a
   * screen with nothing wrong on it.
   */
  /**
   * Each thing blocking the publish, separately.
   *
   * A page can be held up by more than one — no working hours AND no invoice
   * details — and they are fixed on different tabs. Joined into one paragraph
   * with a single link, the second problem was stated and then offered no way
   * to act on it.
   */
  const [publishGaps, setPublishGaps] = useState<Array<{ kind: string; message: string }>>([]);
  const [previewChecking, setPreviewChecking] = useState(false);

  /**
   * Why a smart link could not be switched on, against the link it belongs to.
   *
   * The activate button checked only `response.ok` and did nothing else, so the
   * moment activation could be REFUSED — a link whose journey has no working
   * hours behind it, or no card processor — the button became one that silently
   * does nothing. A refusal the person cannot see is worse than no gate at all.
   */
  const [smartLinkNotice, setSmartLinkNotice] = useState<{
    id: string;
    message: string;
    /** Each blocking gap on its own, so each can carry the control that fixes it. */
    gaps: Array<{ kind: string; message: string }>;
  } | null>(null);

  const [deleteWebsiteOpen, setDeleteWebsiteOpen] = useState(false);
  const [deletingWebsite, setDeletingWebsite] = useState(false);

  /**
   * Delete the website: the page, its sections, and the copy behind them.
   *
   * `purge_content=true` is what makes this different from deleting a landing
   * page. `website_content` is per-business rather than per-page, so without it
   * the words survive and quietly reappear on the next site — which is not what
   * anybody means by "delete my website".
   *
   * `mode=permanent`, because archiving would leave a site the business can
   * neither see nor reach, and they have just said they want it gone.
   */
  const handleDeleteWebsite = async () => {
    if (!page || deletingWebsite) return;
    setDeletingWebsite(true);
    try {
      const response = await fetch(
        `/api/website/pages/${page.id}?mode=permanent&purge_content=true`,
        { method: 'DELETE' }
      );
      const data = await response.json();

      if (!data.success) {
        logger.error({ error: data.error, pageId: page.id }, 'Failed to delete website');
        setGenerationNotice({ kind: 'error', message: labels.delete_website_failed });
        return;
      }

      if (data.contentPurged === false) {
        // The page is gone but the copy is not. Said plainly rather than
        // reported as a clean delete.
        setGenerationNotice({ kind: 'warning', message: data.warning || labels.delete_website_failed });
      }

      logger.info({ pageId: page.id }, 'Website deleted');
      setDeleteWebsiteOpen(false);

      // Back to the state a business with no website is in, without a reload:
      // everything on this screen was about the page that no longer exists.
      setPage(null);
      setAllPages(prev => prev.filter(p => p.id !== page.id));
      setBlocks([]);
      wizardPageRef.current = null;
      setViewMode('overview');
    } catch (error) {
      logger.error({ err: error, pageId: page.id }, 'Website delete request failed');
      setGenerationNotice({ kind: 'error', message: labels.delete_website_failed });
    } finally {
      setDeletingWebsite(false);
    }
  };
  const [allPages, setAllPages] = useState<WebsitePage[]>([]);
  const [blocks, setBlocks] = useState<WebsiteBlock[]>([]);

  /**
   * Services edited in the configuration dialog, opened over this page.
   *
   * The journey is a property of a service, so the only way to change it is to
   * change the service — this is the link out of the read-only view below.
   */
  const { openConfiguration } = useConfigurationDialog();

  /** Whether the business collects an intake form. It comes last in a journey. */
  const [intakeEnabled, setIntakeEnabled] = useState(false);
  /**
   * A card can be charged right now.
   *
   * Starts false, like `intakeEnabled`: the journey strip draws a payment step
   * from it, and a preview promising a card form the client cannot complete is
   * the thing worth not showing. It appears as soon as the fetch confirms it.
   */
  const [processorReady, setProcessorReady] = useState(false);

  /**
   * The services this page shows, with the two facts their journeys are built
   * from. Read off the services block — the page's own catalogue — so the
   * journeys listed here are exactly the ones a visitor meets.
   */
  const journeyServices = useMemo<PublicServiceRow[]>(() => {
    const servicesBlock = blocks.find(b => b.block_type === 'services');
    const listed = (servicesBlock?.content?.services as (PublicServiceRow & { hidden?: boolean })[] | undefined) || [];
    return listed.filter(service => service.hidden !== true);
  }, [blocks]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/intake/settings')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        // Same question as the configuration dialog asks, from the same helper.
        if (!cancelled && data?.success) setIntakeEnabled(intakeReachesClient(data.settings));
      })
      .catch(() => {
        // The strip simply omits the step; not worth a message.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // `charges_enabled` is the whole question — the same flag Stripe itself
    // enforces when a charge is created.
    fetch('/api/payments/stripe-connect')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setProcessorReady(data?.data?.charges_enabled === true);
      })
      .catch(() => {
        // Left false. The strip omits the payment step, which is the safe
        // reading when we could not find out.
      });
    return () => { cancelled = true; };
  }, []);
  const [templates, setTemplates] = useState<WebsiteTemplate[]>([]);

  /**
   * The template this business wears.
   *
   * Read from the business, not from whichever page happens to be open: it is
   * what the landing pages, the smart links, the invoice PDF and every
   * transactional email are drawn from, none of which require a website. Keyed
   * off the open page, nothing was ever marked as current for a business
   * without one — exactly the business that needs to see its own look.
   */
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);

  /** Honour the system setting rather than animating at everyone. */
  const prefersReducedMotion = useReducedMotion();

  /**
   * The template matched to this business, from /api/website/templates.
   *
   * The wizard pre-selected `templates[0]` — first in the array — which is how
   * a parenting school ended up on an academic-tutoring theme. This is the
   * matched one, and it is only a pre-selection: the person can still choose.
   */
  const [recommendedTemplateId, setRecommendedTemplateId] = useState<string | undefined>(undefined);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  /**
   * Whether to offer building a website at all.
   *
   * A business that chose a booking page — or nothing — during onboarding was
   * still shown the template picker and a "Create website" button, offering the
   * thing they had just declined. Landing pages and smart links stay either
   * way: for those businesses that IS their online presence.
   *
   * Only the offer is withdrawn, never the management of a page that already
   * exists. That block renders on `page &&` below, so a live site keeps its
   * editor rather than being stranded published with no way back in.
   */
  const offerWebsite = wantsWebsite(businessProfile?.online_presence_mode);


  const [hasPaidServices, setHasPaidServices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [showCreatePageModal, setShowCreatePageModal] = useState(false);
  const [showLandingPageWizard, setShowLandingPageWizard] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [smartLinksRefreshTrigger, setSmartLinksRefreshTrigger] = useState(0);
  const [smartLinks, setSmartLinks] = useState<SmartLink[]>([]);

  /**
   * What to do next about being findable, and why.
   *
   * The dashboard sends people here saying "clients cannot find you" and this
   * page used to say nothing about it — a website card, a list of landing pages
   * and a list of links, with no indication which of the three the dashboard
   * meant. Three different routes satisfy that step; naming the one that is
   * shortest for THIS business is the whole point of the notice below.
   */
  const presenceGuidance = useMemo(
    () =>
      onlinePresenceGuidance({
        wantsWebsite: offerWebsite,
        hasWebsite: Boolean(page),
        websitePublished: page?.status === 'live',
        livePages: allPages.filter(p => p.page_type === 'landing' && p.status === 'live').length,
        draftPages: allPages.filter(p => p.page_type === 'landing' && p.status !== 'live').length,
        bookingLinkActive: smartLinks.some(l => l.destination_type === 'booking' && l.is_active),
        bookingLinkExists: smartLinks.some(l => l.destination_type === 'booking'),
      }),
    [offerWebsite, page, allPages, smartLinks]
  );
  const [editingSmartLink, setEditingSmartLink] = useState<{
    id: string;
    name: string | null;
    metadata?: {
      journeyType?: 'contact-only' | 'full';
      serviceIds?: string[];
      flow?: string[];
      destinationType?: 'form' | 'booking';
    } | null;
  } | null>(null);
  const [togglingSmartLinkStatus, setTogglingSmartLinkStatus] = useState<string | null>(null);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageSlug, setNewPageSlug] = useState('');
  const [selectedTemplateForNewPage, setSelectedTemplateForNewPage] = useState<string | null>(null);

  // Block editing state
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [editingBlockContent, setEditingBlockContent] = useState<Record<string, unknown> | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);
  const [refreshingServices, setRefreshingServices] = useState(false);

  // Sync with business data state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; message: string } | null>(null);
  const [resettingOrder, setResettingOrder] = useState(false);
  const [enrichmentSummary, setEnrichmentSummary] = useState<{
    has_services: boolean;
    service_count: number;
    has_profile: boolean;
    has_clients: boolean;
    client_count: number;
  } | null>(null);

  // AI generation state
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);
  /**
   * The block whose AI writing was just refused because the platform operator
   * switched website AI off (Layer 2 FR-14). Null the rest of the time, which
   * is almost always. Holds a block id rather than a boolean so the sentence
   * appears in the section the owner is actually editing.
   */
  const [aiWritingUnavailable, setAiWritingUnavailable] = useState<string | null>(null);

  // Settings form state
  const [subdomain, setSubdomain] = useState('');
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    title: '',
    meta_description: '',
    favicon_url: '',
    website_language: 'en' as 'en' | 'es' | 'he'
  });
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Design form state
  const [designForm, setDesignForm] = useState({
    primaryColor: '#4F6EF7',
    secondaryColor: '#6366F1',
    headingFont: 'Inter',
    bodyFont: 'Inter'
  });
  const [savingDesign, setSavingDesign] = useState(false);

  // Testimonial enhancement state
  const [enhancingTestimonial, setEnhancingTestimonial] = useState(false);
  const [enhancingTestimonialIndex, setEnhancingTestimonialIndex] = useState<number | null>(null);

  // Client Journey state (for main website)
  // New steps: 'scheduling' (date/time), 'client_info' (name/email/phone)
  // Legacy 'booking' = scheduling + client_info combined
  const [clientFlow, setClientFlow] = useState<FlowStepKey[]>(['scheduling', 'client_info', 'confirmation']);
  const [servicesOnly, setServicesOnly] = useState(false);
  const [processTitle, setProcessTitle] = useState('');
  const [processSubtitle, setProcessSubtitle] = useState('');

  // Landing page client journey state (stored in booking_widget block)
  // Default includes scheduling + client_info + confirmation for services
  // For courses/products, default is client_info + confirmation (no scheduling)
  const [landingPageClientFlow, setLandingPageClientFlow] = useState<FlowStepKey[]>(['scheduling', 'client_info', 'confirmation']);
  const [savingLandingPageJourney, setSavingLandingPageJourney] = useState(false);

  // Load landing page client flow from booking_widget block when editing a landing page
  useEffect(() => {
    if (page?.page_type === 'landing' && blocks.length > 0) {
      // Client flow can be stored in booking_widget, pricing, or cta block
      const sourceBlock = blocks.find(b => b.block_type === 'booking_widget')
        || blocks.find(b => b.block_type === 'pricing')
        || blocks.find(b => b.block_type === 'cta');
      if (sourceBlock?.content?.client_flow && Array.isArray(sourceBlock.content.client_flow)) {
        const flow = sourceBlock.content.client_flow as FlowStepKey[];
        // Load flow as-is - all 4 steps are fully configurable
        // Only ensure confirmation is at the end if it's included
        const hasConfirmation = flow.includes('confirmation');
        const normalizedFlow: FlowStepKey[] = flow.filter(s => s !== 'confirmation');
        if (hasConfirmation) {
          normalizedFlow.push('confirmation');
        }
        setLandingPageClientFlow(normalizedFlow.length > 0 ? normalizedFlow : ['confirmation']);
      }
    }
  }, [page?.id, page?.page_type, blocks]);

  // Configuration dialog state (for services editing)
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Add Section modal state
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [addingSection, setAddingSection] = useState(false);

  // Setup Wizard state
  const [wizardChecked, setWizardChecked] = useState(false);

  // Analytics state (for main website)
  const [analytics, setAnalytics] = useState<WebsiteAnalytics | null>(null);

  // Landing page analytics state (keyed by page ID)
  const [landingPagesAnalytics, setLandingPagesAnalytics] = useState<Record<string, {
    total_views: number;
    unique_visitors: number;
    views_today: number;
    visitors_today: number;
    views_this_month: number;
    visitors_this_month: number;
    views_30d: number;
    visitors_30d: number;
    views_7d: number;
    visitors_7d: number;
  }>>({});

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState<{ id: string; title: string; hasActivity: boolean; viewCount: number } | null>(null);
  const [checkingActivity, setCheckingActivity] = useState(false);

  // Smart link delete dialog state
  const [deleteSmartLinkDialogOpen, setDeleteSmartLinkDialogOpen] = useState(false);
  const [deletingSmartLink, setDeletingSmartLink] = useState<{ id: string; name: string } | null>(null);
  const [deletingSmartLinkLoading, setDeletingSmartLinkLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // Refetch smart links when trigger changes
  useEffect(() => {
    if (smartLinksRefreshTrigger > 0) {
      const refetchSmartLinks = async () => {
        try {
          const response = await fetch('/api/smart-links?active=false');
          const data = await response.json();
          if (data.success && data.links) {
            setSmartLinks(data.links);
          }
        } catch (err) {
          logger.warn({ err }, 'Failed to refetch smart links');
        }
      };
      refetchSmartLinks();
    }
  }, [smartLinksRefreshTrigger]);

  /**
   * Reload everything this page shows.
   *
   * `silent` skips the loading state, for a refresh that follows an action the
   * owner has already seen the result of. Applying a template is the case it
   * was added for: the tab already shows the new choice, so tearing the editor
   * down to a spinner and rebuilding it reads as a failure rather than as a
   * confirmation — and it throws away the scroll position on a long page.
   */
  const fetchData = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);

      // Three calls that need nothing from anything above them, so they go out
      // now rather than queueing behind the profile and the pages. Their
      // results are applied further down, at the line they were applied before.
      const templatePromise = startFetch<{ success: boolean; templateId?: string | null }>(
        '/api/business-os/business-template'
      );
      const addressPromise = startFetch<{ success: boolean; subdomain?: string }>(
        '/api/business-os/business-subdomain'
      );
      const smartLinksPromise = startFetch<{ success: boolean; links?: SmartLink[] }>(
        '/api/smart-links?active=false'
      );

      // The pages and the services take no arguments and read nothing from the
      // profile, so they go out alongside it rather than behind it. Only the
      // TEMPLATES call needs the vertical, and that one still waits below.
      const pagesPromise = startFetch<{ success: boolean; pages?: WebsitePage[] }>(
        '/api/website/pages'
      );
      const servicesPromise = startFetch<{ success: boolean; services?: { price?: number }[] }>(
        '/api/scheduling/services'
      );

      // First fetch profile to get vertical for template filtering
      const profileResponse = await fetch('/api/business-os/profile');
      const profileData = await profileResponse.json();

      let profile: BusinessProfile | null = null;
      if (profileData.success && profileData.profile) {
        profile = profileData.profile as BusinessProfile;
        setBusinessProfile(profile);
        // Auto-generate subdomain from company name if not already set
        if (profile.company_name) {
          const generatedSubdomain = profile.company_name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          setSubdomain(generatedSubdomain);
        }
      }

      // Fetch pages, templates, and scheduling services.
      //
      // The sub-vertical and description go too: the vertical alone only
      // narrows a gallery, and it is the sub-vertical that tells a parenting
      // school apart from an academic tutor — both of which arrive here as
      // `tutor`. The API answers with a `recommendedTemplateId` and the list
      // ordered to match.
      const templateParams = new URLSearchParams();
      if (profile?.vertical) templateParams.set('vertical', profile.vertical);
      if (profile?.sub_vertical) templateParams.set('sub_vertical', profile.sub_vertical);
      if (profile?.description) templateParams.set('description', String(profile.description).slice(0, 600));
      const templatesUrl = templateParams.toString()
        ? `/api/website/templates?${templateParams.toString()}`
        : '/api/website/templates';

      // Templates alone still waits for the profile — it is the only one of the
      // three whose URL is built from the vertical. The other two were started
      // above and are collected here, at the line they were read before, so
      // everything below sees the same values in the same order as always.
      const templatesResponse = await fetch(templatesUrl);

      const [pagesData, templatesData, servicesData] = await Promise.all([
        pagesPromise.then(settled),
        templatesResponse.json(),
        servicesPromise.then(settled)
      ]);

      // Check for paid services
      if (servicesData.success && servicesData.services) {
        const paidServices = servicesData.services.filter((s: { price?: number }) => s.price && s.price > 0);
        setHasPaidServices(paidServices.length > 0);
      }

      if (pagesData.success && pagesData.pages?.length > 0) {
        // Store all pages
        setAllPages(pagesData.pages);

        // Get the homepage (first page)
        // The homepage, or nothing. The `|| pages[0]` fallback that used to be
        // here handed the role of "the website" to whatever page happened to be
        // first — a landing page, on any account without a site. That is why
        // the header opened already wearing a landing page's title, and why the
        // Overview tab could show one where the website belongs.
        const homepage = pagesData.pages.find((p: WebsitePage) => p.page_type === 'homepage') || null;
        setPage(homepage);

        /*
         * Everything this block still needs, requested at once.
         *
         * All three depend only on the page list that just arrived, and on
         * nothing from each other. They used to run in sequence — blocks, then
         * the site's analytics, then one request per landing page — so a
         * business with four landing pages waited seven round trips here alone.
         * Each is still awaited and applied at its original line below, so the
         * order of every setState is unchanged.
         */
        const blocksPromise = homepage
          ? startFetch<{ success: boolean; blocks?: WebsiteBlock[] }>(
              `/api/website/pages/${homepage.id}/blocks-with-content`
            )
          : null;

        const analyticsPromise = startFetch<{ success: boolean; analytics?: WebsiteAnalytics }>(
          '/api/website/analytics'
        );

        const landingPages = pagesData.pages.filter((p: WebsitePage) => p.page_type === 'landing');
        const activityPromises = landingPages.map((lp: WebsitePage) =>
          startFetch<{ success: boolean; analytics?: unknown }>(
            `/api/website/pages/${lp.id}/activity?full=true`
          ).then(result => ({
            pageId: lp.id,
            analytics: result.ok && result.value.success ? result.value.analytics : null,
          }))
        );

        // Everything below reads the website's own fields, so it only runs when
        // there is one. Without a site the page shows its create-a-website
        // invitation with the lead generation list beneath, which is what an
        // account reaching clients by link alone actually has.
        if (homepage) {
        // Use existing subdomain if set, otherwise use the generated one from profile
        if (homepage.subdomain) {
          setSubdomain(homepage.subdomain);
        }
        // Populate settings form
        setSettingsForm({
          title: homepage.title || '',
          meta_description: homepage.meta_description || '',
          favicon_url: homepage.favicon_url || '',
          website_language: homepage.website_language || 'en'
        });
        // Populate design form
        setDesignForm({
          primaryColor: homepage.theme?.colors?.primary || '#4F6EF7',
          secondaryColor: homepage.theme?.colors?.secondary || '#6366F1',
          headingFont: homepage.theme?.fonts?.heading || 'Inter',
          bodyFont: homepage.theme?.fonts?.body || 'Inter'
        });

        // Fetch blocks for this page (with content from central store)
        const blocksData = settled(await blocksPromise!);
        if (blocksData.success) {
          // Repaired here too: this is the path that runs on opening the page,
          // so a site missing its footer regains one without the owner having
          // to click into a section first.
          const withFooter = await ensureRequiredBlock(homepage.id, homepage.page_type, 'footer', blocksData.blocks || [], profile?.company_name);
          setBlocks(await ensureRequiredBlock(homepage.id, homepage.page_type, 'process', withFooter));
          // Extract client flow from process block
          const processBlock = (blocksData.blocks || []).find((b: WebsiteBlock) => b.block_type === 'process');
          if (processBlock?.content) {
            // Load client_flow - always load it if it exists
            if (processBlock.content.client_flow && Array.isArray(processBlock.content.client_flow)) {
              const savedFlow = processBlock.content.client_flow as FlowStepKey[];
              const flowWithConfirmation: FlowStepKey[] = savedFlow.includes('confirmation')
                ? savedFlow
                : [...savedFlow.filter(s => s !== 'confirmation'), 'confirmation' as const];
              setClientFlow(flowWithConfirmation);
            }
            // Set services_only mode separately
            if (processBlock.content.services_only) {
              setServicesOnly(true);
            } else {
              setServicesOnly(false);
            }
            // Load title and subtitle
            setProcessTitle((processBlock.content.title as string) || '');
            setProcessSubtitle((processBlock.content.subtitle as string) || '');
          }
        }

        }

        // Fetch website analytics
        try {
          const analyticsData = settled(await analyticsPromise);
          if (analyticsData.success && analyticsData.analytics) {
            setAnalytics(analyticsData.analytics);
          }
        } catch (err) {
          logger.warn({ err }, 'Failed to fetch website analytics');
        }

        // Fetch analytics for all landing pages
        if (activityPromises.length > 0) {
          const results = await Promise.all(activityPromises);
          const analyticsMap: Record<string, typeof results[0]['analytics']> = {};
          results.forEach(r => {
            if (r.analytics) {
              analyticsMap[r.pageId] = r.analytics;
            }
          });
          setLandingPagesAnalytics(analyticsMap);
        }

      }

      // What look the business is wearing — asked for regardless of pages, like
      // the smart links below. Inside the `pages.length > 0` guard this never
      // ran for a business with no website, which is the one case where nothing
      // else on the page can show which template it is on.
      try {
        const templateData = settled(await templatePromise);
        if (templateData.success) setCurrentTemplateId(templateData.templateId ?? null);
      } catch (err) {
        logger.warn({ err }, 'Could not read the business template');
      }

      /*
       * The address the business publishes under.
       *
       * `subdomain` was seeded from the company name and then only ever
       * overwritten by the HOMEPAGE's — so an address chosen while publishing a
       * landing page never appeared in the website's Settings screen, which
       * went on suggesting a name the business was not actually using.
       *
       * This is why the request was started early but is applied HERE, and not
       * raced with the others: `setSubdomain` is written three times — company
       * name, then homepage, then this — and the last write is the one the
       * Settings screen shows. Awaiting it at its original position keeps that
       * order exactly.
       */
      try {
        const addressData = settled(await addressPromise);
        if (addressData.success && addressData.subdomain) {
          setSubdomain(addressData.subdomain);
        }
      } catch (err) {
        logger.warn({ err }, 'Could not read the business web address');
      }

      // Fetch smart links (always, regardless of pages) - include inactive for filtering
      try {
        const smartLinksData = settled(await smartLinksPromise);
        if (smartLinksData.success && smartLinksData.links) {
          setSmartLinks(smartLinksData.links);
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to fetch smart links');
      }

      if (templatesData.success) {
        setTemplates(templatesData.templates || []);
        setRecommendedTemplateId(templatesData.recommendedTemplateId);
      }

      // Check if we should show setup wizard
      if (!wizardChecked) {
        setWizardChecked(true);

        // Check for ?pageId=... query param (from landing page creation)
        const pageIdParam = searchParams.get('pageId');
        if (pageIdParam && pagesData.pages) {
          const targetPage = pagesData.pages.find((p: WebsitePage) => p.id === pageIdParam);
          if (targetPage) {
            // Load the specific page (e.g., newly created landing page)
            handleSelectPage(targetPage);
            // Clean up the URL
            router.replace('/business-os/website', { scroll: false });
            return; // Skip wizard check since we're loading a specific page
          }
        }

        // Check for ?view=design (from the dashboard's Design setup pill), so
        // the theme is reachable in one click rather than three.
        if (searchParams.get('view') === 'design') {
          setViewMode('design');
          router.replace('/business-os/website', { scroll: false });
          return;
        }

        // Check for ?view=links, from the dashboard's "give clients a way to
        // book" step on an account that declined a website. It opens the
        // acquisition wizard — where a booking link is made — instead of
        // falling through to the site builder below, which is the one thing
        // this business has already said it does not want.
        if (searchParams.get('view') === 'links') {
          setViewMode('overview');
          setShowLandingPageWizard(true);
          router.replace('/business-os/website', { scroll: false });
          return;
        }

        // Check for ?wizard=true query param (from dashboard setup card)
        const wizardParam = searchParams.get('wizard');
        if (wizardParam === 'true') {
          setViewMode('wizard');
          // Clean up the URL
          router.replace('/business-os/website', { scroll: false });
        } else {
          // Auto-show wizard ONLY for first-time users with no generated content
          const hasNoPage = !pagesData.pages || pagesData.pages.length === 0;

          // …and only for someone who actually wants a website.
          //
          // The wizard hides the whole header row, so a business reaching
          // clients by smart link watched its four tabs vanish the moment the
          // page finished loading — dropped into building a site it had
          // already declined, with no way back to its own links.
          if (hasNoPage && wantsWebsite(profileData?.profile?.online_presence_mode)) {
            setViewMode('wizard');
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch website data');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Handle wizard completion - uses same API/tables as edit page
  /**
   * The page the wizard is configuring, created if it does not exist yet.
   *
   * Every step of both wizard handlers was written against an existing page —
   * `if (!page) return;` — from when the wizard was reachable only once a
   * website existed. It is now the front door from the header, so running it
   * with no website walked all four steps, saved a draft, and configured
   * nothing: the user came back to the same empty card.
   *
   * The ref rather than the state is what the preview step and the finish step
   * share. Both can run before React has flushed `setPage`, and creating the
   * page twice would leave the business with two homepages.
   */
  const ensureWizardPage = async (
    templateId?: string
  ): Promise<{ page: WebsitePage; created: boolean } | null> => {
    if (page) return { page, created: false };
    if (wizardPageRef.current) return { page: wizardPageRef.current, created: true };

    const createResponse = await fetch('/api/website/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        page_type: 'homepage',
        title: businessProfile?.company_name || 'My Website',
        // Without this the route defaults to English, so a Hebrew business
        // building its site through the wizard got a page of English template
        // copy — the one thing it would certainly have to rewrite.
        website_language: language,
        // Given explicitly because the route derives one from the title by
        // stripping everything outside a-z0-9 — a Hebrew business name leaves
        // nothing behind, and the page would be created at "/".
        slug: 'home',
      }),
    });
    const createData = await createResponse.json();

    if (!createData.success || !createData.page) {
      logger.error({ error: createData.error }, 'Wizard could not create the website page');
      return null;
    }

    const built = createData.page as WebsitePage;
    wizardPageRef.current = built;
    setPage(built);
    setAllPages(prev => [...prev, built]);
    return { page: built, created: true };
  };

  const handleWizardComplete = async (result: WizardResult) => {
    try {
      logger.info({ result }, 'Wizard completed');

      // The wizard has to be able to build the house it decorates.
      const ensured = await ensureWizardPage(result.templateId);
      if (!ensured) {
        logger.error('Wizard finished without a page to configure');
        return;
      }
      const target = ensured.page;

      /*
       * No generation here — it happens in `handleBeforePreview`.
       *
       * This branch used to hold it, guarded by `ensured.created`, and it never
       * ran once: `handleBeforePreview` creates the page on step 2 and calls
       * `setPage`, so by the time Publish is pressed `ensureWizardPage` returns
       * at its first line with `created: false`. The site was written by nobody
       * and kept the static English scaffold.
       *
       * Generating on publish would also be the wrong moment — the person would
       * approve one preview and get a different site.
       */
      if (result.templateId) {
        // Step 1: Apply template (recreates blocks with standard structure)
        await fetch(`/api/website/pages/${target.id}/apply-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: result.templateId })
        });
      }

      // Step 2: Fetch fresh blocks after template application
      const blocksResponse = await fetch(`/api/website/pages/${target.id}/blocks-with-content`);
      const blocksData = await blocksResponse.json();
      const freshBlocks: WebsiteBlock[] = blocksData.success ? (blocksData.blocks || []) : [];

      // Step 3: Update subdomain
      if (result.subdomain) {
        await fetch(`/api/website/pages/${target.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: result.subdomain })
        });
        setSubdomain(result.subdomain);
      }

      // Step 4: record whether this site's header wears the business logo. The
      // image itself lives on the business profile and is injected when blocks
      // are read, so nothing here stores a URL.
      if (result.showLogo !== undefined) {
        const headerBlock = freshBlocks.find(b => b.block_type === 'header');
        if (headerBlock) {
          await fetch(`/api/website/pages/${target.id}/blocks/${headerBlock.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { ...headerBlock.content, show_logo: result.showLogo }
            })
          });
        }
      }

      // Step 5: Update process block with client_flow (same as handleSaveJourney)
      if (result.clientFlow) {
        const processBlock = freshBlocks.find(b => b.block_type === 'process');
        const isServicesOnly = result.clientFlow.length === 1 && result.clientFlow[0] === 'confirmation';
        const contentToSave = {
          ...(processBlock?.content || {}),
          client_flow: result.clientFlow,
          services_only: isServicesOnly
        };

        if (processBlock) {
          await fetch(`/api/website/pages/${target.id}/blocks/${processBlock.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: contentToSave })
          });
        } else {
          await fetch(`/api/website/pages/${target.id}/blocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              block_type: 'process',
              position: freshBlocks.length,
              content: contentToSave
            })
          });
        }
      }

      // Step 6: Update services block with hidden flags (same as edit page toggle)
      {
        const servicesBlock = freshBlocks.find(b => b.block_type === 'services');
        if (servicesBlock) {
          // Fetch services from API (same source as edit page)
          const servicesResponse = await fetch('/api/website/blocks/services');
          if (servicesResponse.ok) {
            const servicesData = await servicesResponse.json();
            if (servicesData.services && servicesData.services.length > 0) {
              const hiddenSet = new Set(result.hiddenServiceIds);
              // Build services array with hidden flag - same structure as edit page
              const servicesWithHidden = servicesData.services.map((s: PublicServiceRow) => ({
                name: s.name,
                description: s.description || '',
                price: s.price,
                priceRaw: s.priceRaw,
                duration: s.duration,
                durationMinutes: s.durationMinutes,
                icon: s.icon || 'Briefcase',
                // Kept, not dropped: without these the public page loses the
                // two facts that decide the service's journey, and falls back
                // to describing one story for the whole site.
                is_scheduled: s.is_scheduled,
                collection: s.collection,
                hidden: hiddenSet.has(s.id)
              }));

              // Save to services block (same API as handleSaveBlockContent)
              await fetch(`/api/website/pages/${target.id}/blocks/${servicesBlock.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content: { ...servicesBlock.content, services: servicesWithHidden }
                })
              });
            }
          }
        }
      }

      // Step 7: Publish if requested
      // `page` here is the state as it was when the wizard opened — null for a
      // site the wizard has just created — so publishing was skipped for
      // exactly the case that needed it.
      if (result.shouldPublish) {
        await fetch(`/api/website/pages/${target.id}/publish`, {
          method: 'POST'
        });
      }

      // Update local state for responsive UI
      const isServicesOnly = result.clientFlow.length === 1 && result.clientFlow[0] === 'confirmation';
      setClientFlow(result.clientFlow);
      setServicesOnly(isServicesOnly);

      // Close wizard and refresh
      setViewMode('overview');
      await fetchData();
    } catch (error) {
      logger.error({ err: error }, 'Failed to complete wizard');
    }
  };

  const handleWizardSkip = () => {
    setViewMode('overview');
  };

  // Handle saving wizard state before showing preview (Step 4)
  // This ensures the preview shows accurate data including hidden services
  const handleBeforePreview = async (data: Omit<WizardResult, 'shouldPublish'>) => {
    try {
      logger.info({ data }, 'Saving wizard state before preview');

      // Built here if this is a new website, so the preview shows the site
      // being described rather than nothing at all.
      const ensured = await ensureWizardPage(data.templateId);
      if (!ensured) return;
      const target = ensured.page;

      /*
       * Step 1: write the site, or just re-theme it.
       *
       * This is where generation belongs, and it was not happening anywhere.
       * `handleWizardComplete` had an AI branch, but it was unreachable: THIS
       * function creates the page and calls `setPage`, so by the time Publish
       * runs `ensureWizardPage` returns `created: false` and the branch is
       * skipped. Every site therefore kept the static English scaffold that
       * page creation installs — "Your Business", "Another Client",
       * contact@yourbusiness.com — and the only way out was a path nobody could
       * reach. Generating here also means the step-3 preview shows the real
       * site rather than boilerplate that changes after publishing.
       *
       * Generation REPLACES every block on the page, so it is gated on
       * `content_generated_at`: a page that has never been written is safe to
       * write, and one that has may hold edits nobody authorised us to discard.
       */
      const neverGenerated = !target.content_generated_at;

      if (neverGenerated) {
        setGenerating(true);
        setGenerationNotice(null);
        try {
          const generated = await fetch('/api/website/generate-from-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: businessProfile?.user_id,
              pageId: target.id,
              templateId: data.templateId,
            }),
          });
          const generatedData = await generated.json();

          if (generatedData.code === 'ai_unavailable') {
            /*
             * Switched off, not broken (Layer 2 FR-14). Shown as a warning
             * rather than an error, and in the reader's language rather than
             * the route's English sentence: nothing failed, nothing was
             * overwritten, and the page they had is still the page they have.
             */
            logger.info({ pageId: target.id }, 'Website generation unavailable: AI writing is switched off');
            setGenerationNotice({ kind: 'warning', message: labels.ai_unavailable });
          } else if (!generatedData.success) {
            // Said out loud rather than logged and swallowed, which is how a
            // failed generation used to look exactly like a finished site.
            logger.error({ error: generatedData.error, pageId: target.id }, 'Website generation failed');
            setGenerationNotice({ kind: 'error', message: generatedData.error || labels.generation_failed });
          } else if (generatedData.warning) {
            logger.warn({ warning: generatedData.warning, pageId: target.id }, 'Website generated with warnings');
            setGenerationNotice({ kind: 'warning', message: labels.generation_degraded });
          }
        } catch (error) {
          logger.error({ err: error, pageId: target.id }, 'Website generation request failed');
          setGenerationNotice({ kind: 'error', message: labels.generation_failed });
        } finally {
          setGenerating(false);
        }
      } else if (data.templateId && data.templateId !== target.template_id) {
        // Theme only. `apply-template` preserves content by contract, which is
        // what makes it the right call for a page that already has some.
        await fetch(`/api/website/pages/${target.id}/apply-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: data.templateId })
        });
      }

      // Step 2: Fetch fresh blocks
      const blocksResponse = await fetch(`/api/website/pages/${target.id}/blocks-with-content`);
      const blocksData = await blocksResponse.json();
      const freshBlocks: WebsiteBlock[] = blocksData.success ? (blocksData.blocks || []) : [];

      // Step 3: record the header's logo choice (the image comes from the profile)
      if (data.showLogo !== undefined) {
        const headerBlock = freshBlocks.find(b => b.block_type === 'header');
        if (headerBlock) {
          await fetch(`/api/website/pages/${target.id}/blocks/${headerBlock.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { ...headerBlock.content, show_logo: data.showLogo }
            })
          });
        }
      }

      // Step 4: Update process block with client_flow
      if (data.clientFlow) {
        const processBlock = freshBlocks.find(b => b.block_type === 'process');
        const isServicesOnly = data.clientFlow.length === 1 && data.clientFlow[0] === 'confirmation';
        const contentToSave = {
          ...(processBlock?.content || {}),
          client_flow: data.clientFlow,
          services_only: isServicesOnly
        };

        if (processBlock) {
          await fetch(`/api/website/pages/${target.id}/blocks/${processBlock.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: contentToSave })
          });
        }
      }

      // Step 5: Update services block with hidden flags
      const servicesBlock = freshBlocks.find(b => b.block_type === 'services');
      if (servicesBlock) {
        const servicesResponse = await fetch('/api/website/blocks/services');
        if (servicesResponse.ok) {
          const servicesData = await servicesResponse.json();
          if (servicesData.services && servicesData.services.length > 0) {
            const hiddenSet = new Set(data.hiddenServiceIds);
            const servicesWithHidden = servicesData.services.map((s: PublicServiceRow) => ({
              name: s.name,
              description: s.description || '',
              price: s.price,
              priceRaw: s.priceRaw,
              duration: s.duration,
              durationMinutes: s.durationMinutes,
              icon: s.icon || 'Briefcase',
              is_scheduled: s.is_scheduled,
              collection: s.collection,
              hidden: hiddenSet.has(s.id)
            }));

            await fetch(`/api/website/pages/${target.id}/blocks/${servicesBlock.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: { ...servicesBlock.content, services: servicesWithHidden }
              })
            });
          }
        }
      }

      logger.info('Successfully saved wizard state before preview');
    } catch (error) {
      logger.error({ err: error }, 'Failed to save wizard state before preview');
    }
  };

  // Handle client journey save

  // Toggle a step in the client journey
  const toggleJourneyStep = (step: FlowStepKey) => {
    if (step === 'confirmation') return; // Confirmation is always included

    setClientFlow(prev => {
      if (prev.includes(step)) {
        return prev.filter(s => s !== step);
      } else {
        // Add step in correct order - new steps: scheduling, client_info replace booking
        const order: FlowStepKey[] = ['scheduling', 'client_info', 'booking', 'payment', 'intake', 'confirmation'];
        const newFlow = [...prev, step];
        return order.filter(s => newFlow.includes(s));
      }
    });
  };

  // Move a step in the client journey
  const moveJourneyStep = (step: FlowStepKey, direction: 'up' | 'down') => {
    if (step === 'confirmation') return; // Confirmation must stay at the end

    setClientFlow(prev => {
      const index = prev.indexOf(step);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length - 1) return prev; // Can't move past confirmation

      const newFlow = [...prev];
      [newFlow[index], newFlow[newIndex]] = [newFlow[newIndex], newFlow[index]];
      return newFlow;
    });
  };

  // Toggle a step in the landing page client journey - all steps are fully configurable
  const toggleLandingPageStep = (step: FlowStepKey) => {
    setLandingPageClientFlow(prev => {
      if (prev.includes(step)) {
        // Remove step - but ensure at least one step remains
        const filtered = prev.filter(s => s !== step);
        if (filtered.length === 0) {
          // Must have at least one step
          return prev;
        }
        return filtered;
      } else {
        // Add step in the correct order - new steps: scheduling, client_info replace booking
        const order: FlowStepKey[] = ['scheduling', 'client_info', 'booking', 'payment', 'intake', 'confirmation'];
        const newFlow = [...prev, step];
        // Sort by defined order
        return order.filter(s => newFlow.includes(s));
      }
    });
  };

  // Move a step in the landing page client journey - any step can be reordered
  const moveLandingPageStep = (step: FlowStepKey, direction: 'up' | 'down') => {
    setLandingPageClientFlow(prev => {
      const index = prev.indexOf(step);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      // Can't move to negative or beyond array bounds
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const newFlow = [...prev];
      [newFlow[index], newFlow[newIndex]] = [newFlow[newIndex], newFlow[index]];
      return newFlow;
    });
  };

  // Save landing page client journey - can be stored in booking_widget, pricing, or cta block

  // Handle drag end for landing page journey reorder
  const handleLandingPageJourneyDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeStep = active.id as FlowStepKey;
    const overStep = over.id as FlowStepKey;

    // Don't allow moving confirmation (always last)
    if (activeStep === 'confirmation') return;
    if (overStep === 'confirmation') return;

    setLandingPageClientFlow(prev => {
      const oldIndex = prev.indexOf(activeStep);
      const newIndex = prev.indexOf(overStep);

      if (oldIndex === -1 || newIndex === -1) return prev;
      // Don't allow moving to confirmation position (last)
      if (newIndex >= prev.length - 1) return prev;

      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleCreateLandingPage = async () => {
    if (!newPageTitle.trim()) return;

    try {
      setCreatingPage(true);
      logger.info({ title: newPageTitle, slug: newPageSlug, template: selectedTemplateForNewPage }, 'Creating landing page');

      const response = await fetch('/api/website/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedTemplateForNewPage || templates[0]?.id,
          page_type: 'landing',
          title: newPageTitle.trim(),
          slug: newPageSlug.trim() || newPageTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
        })
      });

      const data = await response.json();
      logger.info({ response: data, status: response.status }, 'Create landing page response');

      if (data.success && data.page) {
        // Add the new page to allPages
        setAllPages(prev => [...prev, data.page]);
        // Reset modal state
        setShowCreatePageModal(false);
        setNewPageTitle('');
        setNewPageSlug('');
        setSelectedTemplateForNewPage(null);
      } else {
        logger.error({ error: data.error, details: data.details }, 'Failed to create landing page');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create landing page');
    } finally {
      setCreatingPage(false);
    }
  };

  // Initiate delete process - check for activity first
  const handleDeletePageClick = async (pageId: string, pageTitle: string) => {
    try {
      setCheckingActivity(true);

      // Check if page has activity
      const activityResponse = await fetch(`/api/website/pages/${pageId}/activity`);
      const activityData = await activityResponse.json();

      if (!activityData.success) {
        logger.error({ error: activityData.error }, 'Failed to check page activity');
        return;
      }

      // Open dialog with activity info
      setDeletingPage({
        id: pageId,
        title: pageTitle,
        hasActivity: activityData.hasActivity,
        viewCount: activityData.viewCount
      });
      setDeleteDialogOpen(true);
    } catch (error) {
      logger.error({ err: error }, 'Failed to check page activity');
    } finally {
      setCheckingActivity(false);
    }
  };

  // Confirm delete - perform actual deletion
  const handleConfirmDelete = async () => {
    if (!deletingPage) return;

    try {
      /*
       * Delete means delete, as it does for a smart link.
       *
       * A page with any traffic was quietly ARCHIVED instead — it left the list
       * and stayed in the database forever, and the button that did it still
       * said "delete". Taking a page out of circulation is now its own action,
       * Unpublish, on the same row; there is no longer a reason for delete to
       * mean something else on the pages that happen to have visitors.
       */
      const response = await fetch(`/api/website/pages/${deletingPage.id}?mode=permanent`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (data.success) {
        setAllPages(prev => prev.filter(p => p.id !== deletingPage.id));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete page');
    } finally {
      setDeleteDialogOpen(false);
      setDeletingPage(null);
    }
  };

  const handleSelectPage = async (selectedPage: WebsitePage) => {
    setPage(selectedPage);
    setSubdomain(selectedPage.subdomain || '');
    // Populate settings form
    setSettingsForm({
      title: selectedPage.title || '',
      meta_description: selectedPage.meta_description || '',
      favicon_url: selectedPage.favicon_url || '',
      website_language: (selectedPage.website_language as 'en' | 'es' | 'he') || 'en'
    });
    // Populate design form
    setDesignForm({
      primaryColor: selectedPage.theme?.colors?.primary || '#4F6EF7',
      secondaryColor: selectedPage.theme?.colors?.secondary || '#6366F1',
      headingFont: selectedPage.theme?.fonts?.heading || 'Inter',
      bodyFont: selectedPage.theme?.fonts?.body || 'Inter'
    });

    // Fetch blocks for selected page (with content from central store)
    try {
      const blocksResponse = await fetch(`/api/website/pages/${selectedPage.id}/blocks-with-content`);
      const blocksData = await blocksResponse.json();
      if (blocksData.success) {
        const repaired = await ensureRequiredBlock(selectedPage.id, selectedPage.page_type, 'footer', blocksData.blocks || []);
        setBlocks(await ensureRequiredBlock(selectedPage.id, selectedPage.page_type, 'process', repaired));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch blocks for page');
    }

    // For landing pages, go directly to sections view to edit content
    // For main website, go to overview
    if (selectedPage.page_type === 'landing') {
      setViewMode('sections');
    } else {
      setViewMode('overview');
    }
  };


  /*
   * Publishing a landing page, and taking it back down.
   *
   * These lived only on the website card, behind `page_type !== 'landing'`, so
   * a landing page had no way to go live at all once its own overview panel was
   * removed — it sat in the list as a permanent draft. They belong on its row,
   * beside Edit and Delete, the way a smart link's activate and deactivate do.
   *
   * Publishing asks for the address first. The slug is generated from the
   * service name and is the one part of the public URL the business chooses, so
   * the moment it becomes public is the moment worth showing it — and the last
   * moment changing it costs nothing.
   */
  const [publishLanding, setPublishLanding] = useState<WebsitePage | null>(null);
  const [publishSlugDraft, setPublishSlugDraft] = useState('');
  /**
   * The address prefix, editable when the business has not settled on one.
   *
   * A landing page inherits the subdomain from the website, and a business with
   * no website has none to inherit — so publishing was refused for want of a
   * setting that only exists in the website's own settings screen. Here it can
   * be typed, prefilled from the company name.
   */
  const [publishSubdomainDraft, setPublishSubdomainDraft] = useState('');
  const [publishLandingBusy, setPublishLandingBusy] = useState(false);
  const [publishLandingError, setPublishLandingError] = useState<string | null>(null);

  const handlePublishLandingConfirm = async () => {
    if (!publishLanding) return;

    const slug = publishSlugDraft.trim().replace(/^\/+|\/+$/g, '');
    if (!slug) return;

    setPublishLandingBusy(true);
    setPublishLandingError(null);
    try {
      const wantedSubdomain = publishSubdomainDraft.trim();
      if (!publishLanding.subdomain && !wantedSubdomain) {
        setPublishLandingError(labels.publish_landing_needs_address);
        return;
      }

      // The address first: publishing a page at the wrong URL and correcting it
      // afterwards means the wrong one was live, however briefly.
      if (!publishLanding.subdomain && wantedSubdomain) {
        const addressed = await fetch(`/api/website/pages/${publishLanding.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: wantedSubdomain })
        });
        const addressedData = await addressed.json().catch(() => ({}));
        if (!addressed.ok) {
          setPublishLandingError(addressedData?.error || labels.publish_landing_failed);
          return;
        }
      }

      if (slug !== publishLanding.slug) {
        const renamed = await fetch(`/api/website/pages/${publishLanding.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug })
        });
        const renamedData = await renamed.json().catch(() => ({}));
        if (!renamed.ok) {
          setPublishLandingError(renamedData?.error || labels.publish_landing_failed);
          return;
        }
      }

      const response = await fetch(`/api/website/pages/${publishLanding.id}/publish`, {
        method: 'POST'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        // The publish route explains itself — no address, nothing on the page,
        // a journey step that cannot run — so show what it said.
        setPublishLandingError(data?.error || labels.publish_landing_failed);
        return;
      }

      setAllPages(prev => prev.map(item =>
        item.id === publishLanding.id
          ? { ...item, slug, subdomain: item.subdomain || wantedSubdomain, status: 'live', published: true }
          : item
      ));
      setPublishLanding(null);
    } catch (error) {
      logger.error({ err: error, pageId: publishLanding.id }, 'Failed to publish landing page');
      setPublishLandingError(labels.publish_landing_failed);
    } finally {
      setPublishLandingBusy(false);
    }
  };

  const handleUnpublishLanding = async (landingPage: WebsitePage) => {
    setPublishLandingBusy(true);
    try {
      const response = await fetch(`/api/website/pages/${landingPage.id}/publish`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setAllPages(prev => prev.map(item =>
          item.id === landingPage.id ? { ...item, status: 'draft', published: false } : item
        ));
      } else {
        setGenerationNotice({ kind: 'error', message: labels.publish_landing_failed });
      }
    } catch (error) {
      logger.error({ err: error, pageId: landingPage.id }, 'Failed to unpublish landing page');
      setGenerationNotice({ kind: 'error', message: labels.publish_landing_failed });
    } finally {
      setPublishLandingBusy(false);
    }
  };

  /**
   * Open the preview — unless the flow it would show cannot run.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Gated on exactly what Publish is gated on, and refusing with the same
   * sentence. A booking step with no working hours behind it shows an empty
   * calendar, and an owner sent into that reads it as a broken preview rather
   * than as a setting they have not filled in — so they hunt for a bug that is
   * not there, and the thing that IS wrong stays invisible until they try to
   * publish.
   *
   * It asks the server rather than deciding here, because the answer depends on
   * which services this page offers and whether the business has hours — two
   * facts the editor does not hold. `pagePublishBlocker` is the same function
   * the publish uses, so the two can never disagree about whether a site is
   * ready.
   */
  /**
   * Ask again whether the page can go live.
   *
   * Run when the settings dialog closes, because the owner has just been sent
   * there to fix the very thing the message names. Without it the refusal and
   * its button sat there after the gap was closed — still telling them to set
   * working hours they had just set — and the only way to clear it was to try
   * publishing again.
   */
  const recheckPublishReadiness = async () => {
    if (!page) return;
    try {
      const response = await fetch(`/api/website/pages/${page.id}/publish`);
      const data = await response.json();

      if (data.ready) {
        setPublishError(null);
        setPublishGaps([]);
        return;
      }

      // Still blocked, but possibly by something else now: one gap closed and
      // another still open must not keep showing the one that was fixed.
      setPublishGaps(Array.isArray(data.gaps) ? data.gaps : []);
      setPublishError(data.error || labels.publish_failed);
    } catch (err) {
      logger.warn({ err }, 'Could not re-check publish readiness');
    }
  };

  const handlePreview = async (pageId?: string) => {
    /*
     * Any page, not just the website.
     *
     * A landing page sells the same services through the same journey, and its
     * preview opened as a plain link — so the one surface most likely to be
     * built for a single paid service was the one that could still walk an
     * owner into a booking flow with no hours behind it. Publishing a landing
     * page already went through this check; previewing one did not.
     */
    const target = pageId ?? page?.id;
    if (!target) return;

    const open = () =>
      window.open(`/website-preview/${target}?lang=${language}`, '_blank', 'noopener,noreferrer');

    try {
      setPreviewChecking(true);
      const response = await fetch(`/api/website/pages/${target}/publish`);
      const data = await response.json();

      if (data.ready === false) {
        logger.warn({ pageId: target, reason: data.reason }, 'Preview refused');
        setPublishGaps(Array.isArray(data.gaps) ? data.gaps : []);
        setPublishError(data.error || labels.publish_failed);
        return;
      }

      setPublishError(null);
      setPublishGaps([]);
      open();
    } catch (error) {
      // A failed CHECK must not stand between an owner and their preview.
      logger.error({ err: error }, 'Could not check preview readiness');
      open();
    } finally {
      setPreviewChecking(false);
    }
  };

  /**
   * Publish — asking about the address first, once.
   *
   * The generated prefix goes live as-is unless the owner is shown it, and the
   * moment before it becomes the address they print and send is the moment they
   * care. Asked only when the site has never been live: re-publishing is not
   * the time to offer a change, because the old address is already written down
   * somewhere.
   */
  const handlePublish = async () => {
    if (!page) return;

    if (!page.published && !publishAddressOpen) {
      setPublishAddressValue(page.subdomain || subdomain || '');
      setSubdomainAvailable(null);
      setPublishAddressOpen(true);
      return;
    }

    try {
      setPublishing(true);

      /*
       * The address first: publishing at the wrong URL and correcting it after
       * means the wrong one was live, however briefly.
       */
      const wanted = publishAddressValue.trim();
      if (wanted && wanted !== page.subdomain) {
        const addressed = await fetch(`/api/website/pages/${page.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain: wanted }),
        });
        const addressedData = await addressed.json().catch(() => ({}));
        if (!addressed.ok) {
          setPublishError(addressedData?.error || labels.publish_failed);
          setPublishing(false);
          return;
        }
        setPage(prev => (prev ? { ...prev, subdomain: wanted } : prev));
        setSubdomain(wanted);
      }

      const response = await fetch(`/api/website/pages/${page.id}/publish`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        setPage(prev => (prev ? { ...prev, status: 'live', published: true } : prev));
        setPublishError(null);
        setPublishGaps([]);
        setPublishAddressOpen(false);
        return;
      }

      /*
       * Say why it was refused.
       *
       * The route sends a sentence naming the services holding it up — "X asks
       * clients to pick a time, but you have no working hours set" — which is
       * the entire point of resolving the gap before publishing. It was being
       * discarded on arrival.
       */
      logger.warn({ pageId: page.id, reason: data.reason }, 'Publish refused');
      setPublishGaps(Array.isArray(data.gaps) ? data.gaps : []);
      setPublishError(data.error || labels.publish_failed);
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish website');
      setPublishError(labels.publish_failed);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!page) return;

    try {
      setPublishing(true);
      const response = await fetch(`/api/website/pages/${page.id}/publish`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (data.success) {
        setPage({ ...page, status: 'draft', published: false });
        setPublishError(null);
        setPublishGaps([]);
        return;
      }

      // Silence is worse on the way down: the owner believes the site is off
      // the air while it is still being served.
      logger.warn({ pageId: page.id }, 'Unpublish refused');
      setPublishError(data.error || labels.unpublish_failed);
    } catch (error) {
      logger.error({ err: error }, 'Failed to unpublish website');
      setPublishError(labels.unpublish_failed);
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = () => {
    if (page?.subdomain) {
      navigator.clipboard.writeText(`https://${page.subdomain}.agentpilot.io`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const checkSubdomainAvailability = async (value: string) => {
    if (!value || value.length < 3) {
      setSubdomainAvailable(null);
      return;
    }

    setCheckingSubdomain(true);
    try {
      const response = await fetch(`/api/website/subdomain/check?subdomain=${encodeURIComponent(value)}`);
      const data = await response.json();
      setSubdomainAvailable(data.available);
    } catch {
      setSubdomainAvailable(null);
    } finally {
      setCheckingSubdomain(false);
    }
  };

  /**
   * Turn one section of the current page on or off.
   *
   * The switch flips immediately and the write follows. When the write fails
   * the switch flips BACK — and that is the whole of what the user used to see:
   * a switch that moved and then undid itself, with the reason going only to
   * `logger.error`, which is the browser console. An expired session, a page
   * deleted in another tab, anything at all — identical silent snap-back. The
   * failure now says so on the page.
   */
  const handleToggleBlock = async (blockId: string, enabled: boolean) => {
    if (!page?.id) {
      logger.error({ blockId }, 'Cannot toggle block: page ID is missing');
      setGenerationNotice({ kind: 'error', message: labels.toggle_section_failed });
      return;
    }

    // Optimistic update. Functional, because `blocks` in this closure is the
    // render's snapshot: flipping two switches before the first request lands
    // used to write the second onto stale state and lose the first.
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, enabled } : b)));

    // Undo just this block rather than restoring a whole captured array, which
    // would also roll back any edit made while the request was in flight.
    const revert = () =>
      setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, enabled: !enabled } : b)));

    try {
      const response = await fetch(`/api/website/pages/${page.id}/blocks/${blockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        revert();
        const body = await response.json().catch(() => ({}));
        logger.error(
          { blockId, pageId: page.id, status: response.status, error: body?.error },
          'Failed to toggle block: API error'
        );
        setGenerationNotice({ kind: 'error', message: labels.toggle_section_failed });
        return;
      }

      setGenerationNotice(null);
    } catch (error) {
      revert();
      logger.error({ err: error, blockId, pageId: page.id }, 'Failed to toggle block');
      setGenerationNotice({ kind: 'error', message: labels.toggle_section_failed });
    }
  };

  /*
   * Blocks a page cannot be without.
   *
   * The footer joins the header here. A page with no footer is not a page
   * somebody chose to end abruptly — it is a page missing its ending, with no
   * copyright line, no closing action, and nowhere for the contact details and
   * opening hours to appear. It is also the block every recipe treats as the
   * boundary that new sections are inserted above, so losing it changes where
   * everything added afterwards lands.
   *
   * Not deletable is not the same as not removable from the site: the switch on
   * every row still turns it off, and a disabled footer does not render on the
   * public page. What that keeps is the block — and with it the owner's
   * settings, and a way back.
   */
  const REQUIRED_BLOCKS: BlockType[] = ['header', 'footer', 'process'];

  // Delete block modal state
  const [deleteBlockModal, setDeleteBlockModal] = useState<{ isOpen: boolean; blockId: string | null; blockType: string | null }>({
    isOpen: false,
    blockId: null,
    blockType: null
  });
  const [deletingBlock, setDeletingBlock] = useState(false);

  const handleDeleteBlockClick = (blockId: string, blockType: BlockType) => {
    // Check if this is a required block
    if (REQUIRED_BLOCKS.includes(blockType)) {
      return; // Don't show delete option for required blocks
    }

    setDeleteBlockModal({ isOpen: true, blockId, blockType });
  };

  const handleDeleteBlock = async () => {
    if (!deleteBlockModal.blockId) return;

    setDeletingBlock(true);
    try {
      const response = await fetch(`/api/website/pages/${page?.id}/blocks/${deleteBlockModal.blockId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setBlocks(blocks.filter(b => b.id !== deleteBlockModal.blockId));
        if (expandedBlockId === deleteBlockModal.blockId) {
          setExpandedBlockId(null);
          setEditingBlockContent(null);
        }
        setDeleteBlockModal({ isOpen: false, blockId: null, blockType: null });
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete block');
    } finally {
      setDeletingBlock(false);
    }
  };

  const handleExpandBlock = async (blockId: string, content: Record<string, unknown>, blockType?: string) => {
    if (expandedBlockId === blockId) {
      setExpandedBlockId(null);
      setEditingBlockContent(null);
    } else {
      setExpandedBlockId(blockId);

      // Auto-fetch real services when expanding a services block ONLY if no services are saved
      if (blockType === 'services') {
        const existingServices = content.services as Array<{ name: string; hidden?: boolean }> | undefined;
        const hasExistingServices = existingServices && existingServices.length > 0;

        // If services already exist in saved content, preserve them (keeps hidden flags)
        if (hasExistingServices) {
          setEditingBlockContent(content);
          return;
        }

        // Only fetch from API if no services are saved yet
        try {
          // Use the website blocks API which returns properly transformed data with smart icons
          const response = await fetch('/api/website/blocks/services');
          if (response.ok) {
            const data = await response.json();
            if (data.services && data.services.length > 0) {
              // API returns transformed services with smart icon mapping based on service name
              const realServices = data.services.map((s: { name: string; description?: string; price?: string; duration?: string; icon?: string }) => ({
                name: s.name,
                description: s.description || '',
                price: s.price,
                duration: s.duration,
                icon: s.icon || 'Briefcase',
                hidden: false
              }));
              setEditingBlockContent({ ...content, services: realServices });
              return;
            }
          }
        } catch (error) {
          logger.error({ err: error }, 'Failed to fetch services for the section editor');
        }
      }

      setEditingBlockContent(content);
    }
  };

  // Refresh services from Scheduling (replaces all services with fresh data)
  const handleRefreshServices = async () => {
    if (!editingBlockContent) return;

    try {
      setRefreshingServices(true);
      // Use the website blocks API which returns properly transformed data with smart icons
      const response = await fetch('/api/website/blocks/services');
      if (response.ok) {
        const data = await response.json();
        if (data.services && data.services.length > 0) {
          // API returns transformed services with smart icon mapping based on service name
          const freshServices = data.services.map((s: { name: string; description?: string; price?: string; duration?: string; icon?: string }) => ({
            name: s.name,
            description: s.description || '',
            price: s.price,
            duration: s.duration,
            icon: s.icon || 'Briefcase',
            hidden: false
          }));
          setEditingBlockContent({ ...editingBlockContent, services: freshServices });
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to refresh services');
    } finally {
      setRefreshingServices(false);
    }
  };

  // Map block types to section names in website_content
  const BLOCK_TO_SECTION: Record<string, string> = {
    'header': 'header',
    'hero': 'hero',
    'about': 'about',
    'services': 'services',
    'testimonials': 'testimonials',
    'faq': 'faq',
    'team': 'team',
    'contact_form': 'contact',
    'process': 'process',
    'features': 'features',
    'stats': 'stats',
    'pricing': 'pricing',
    'gallery': 'gallery',
    'cta': 'cta',
    'newsletter': 'newsletter',
    'logo_cloud': 'logo_cloud',
    'video': 'video',
    'booking_widget': 'booking_widget',
    'payment_button': 'payment_button',
    'intake_form': 'intake_form'
  };

  /*
   * Block types that save straight to the block, not to the shared store.
   *
   * The footer belongs here for the same reason the header does: what it holds
   * is PAGE-specific. A company name, a logo switch, the menu links, the
   * platform credit — none of it is prose that should follow the business
   * across templates, which is what the central content store is for.
   *
   * It was in neither list, and that was not a preference, it was a hole. With
   * no entry in `BLOCK_TO_SECTION` either, `sectionName` came back undefined
   * and the branch below wrote `sections: { undefined: ... }` to the content
   * store — a section literally named "undefined" — while the block itself was
   * never touched. Saving the footer appeared to work and stored nothing.
   */
  const SAVE_DIRECTLY_TO_BLOCK = ['services', 'header', 'process', 'footer'];

  /**
   * Store "services only" where the booking flow reads it.
   *
   * The control now sits in the services section, but the value belongs to the
   * process block: `/api/website/booking/intake` looks it up there by block
   * type and refuses to serve an intake form when it is true. Written on toggle
   * rather than on a Save button, because the services section's own save
   * writes the services list and this is not part of it.
   */
  const persistServicesOnly = async (checked: boolean) => {
    const processBlock = blocks.find(b => b.block_type === 'process');
    if (!page || !processBlock) return;

    try {
      await fetch(`/api/website/pages/${page.id}/blocks/${processBlock.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { ...(processBlock.content || {}), services_only: checked },
        }),
      });
      setBlocks(prev => prev.map(b =>
        b.id === processBlock.id
          ? { ...b, content: { ...(b.content || {}), services_only: checked } as WebsiteBlock['content'] }
          : b
      ));
    } catch (error) {
      logger.error({ err: error }, 'Failed to store the services-only setting');
    }
  };

  const handleSaveBlockContent = async (blockId: string) => {
    if (!editingBlockContent) return;

    try {
      setSavingBlock(true);

      // Find the block to get its type
      const block = blocks.find(b => b.id === blockId);
      if (!block) return;

      const sectionName = BLOCK_TO_SECTION[block.block_type];

      // LANDING PAGES: Always save directly to block content
      // Landing pages don't use central content store - all content is stored in blocks
      const isLandingPage = page?.page_type === 'landing';

      // Certain blocks save directly to block content (page-specific, not shared):
      // - services: includes hidden flags from Scheduling
      // - header: logo/menu is specific to each page
      // - ALL blocks for landing pages: landing pages are standalone, no central content
      // Other sections (homepage only): Save to central content store (persists across templates)
      if (isLandingPage || SAVE_DIRECTLY_TO_BLOCK.includes(block.block_type)) {
        // Save directly to block content
        const response = await fetch(`/api/website/pages/${page?.id}/blocks/${blockId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editingBlockContent })
        });

        if (!response.ok) {
          throw new Error(`Failed to save ${block.block_type}`);
        }

        /*
         * ─────────────────────────────────────────────────────────────────────
         * HOW IT WORKS: THE STEPS ALSO GO ON THE BUSINESS.
         *
         * Saving them to the block alone is not durable.
         * `WebsiteBlockEnrichmentService` re-derives this section's steps every
         * time the site is PUBLISHED, and it prefers
         * `business_profiles.process_steps` over anything already in the block.
         * With that field empty — as it is on every account today — the
         * owner's words are replaced by generated ones at the moment they go
         * live, which is the worst possible time to lose them.
         *
         * The endpoint and the repository methods for this have existed all
         * along and nothing has ever called them. This is that call.
         *
         * Not fatal: the block is saved and the section already reads correctly
         * in the editor. What fails here is durability across a publish, which
         * is worth a log rather than an error the owner cannot act on.
         */
        if (block.block_type === 'process') {
          const steps = (editingBlockContent.steps as Array<{ title?: string; description?: string; icon?: string }> | undefined) ?? [];
          const durable = steps
            .filter(step => step.title?.trim())
            .map((step, index) => ({
              title: step.title!.trim(),
              // The endpoint requires a description; a step with none would
              // fail validation and take the whole list with it.
              description: step.description?.trim() || step.title!.trim(),
              icon: step.icon,
              number: index + 1,
            }));

          if (durable.length > 0) {
            try {
              const stepsResponse = await fetch('/api/website/process-steps', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ steps: durable }),
              });
              if (!stepsResponse.ok) {
                logger.warn({ status: stepsResponse.status }, 'Saved the section but could not store its steps on the business');
              }
            } catch (stepsError) {
              logger.warn({ err: stepsError }, 'Saved the section but could not store its steps on the business');
            }
          }
        }
      } else if (!sectionName) {
        /*
         * A block type with no section mapping cannot be saved to the shared
         * store — there is nowhere to put it. This used to fall through and
         * write `{ undefined: content }`, which the owner experienced as a save
         * button that did nothing and left no trace.
         */
        logger.error({ blockType: block.block_type, blockId }, 'No content section for this block type; refusing to save');
        throw new Error(`No content section mapped for ${block.block_type}`);
      } else {
        // Homepage/main website: Save to central content store (content persists across templates)
        const contentResponse = await fetch('/api/website/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sections: {
              [sectionName]: editingBlockContent
            }
          })
        });

        if (!contentResponse.ok) {
          throw new Error('Failed to save to central content store');
        }

        // Also update the block's styles/layout preferences (not content)
        const styleFields = ['layout', 'alignment', 'columns'];
        const styleContent: Record<string, unknown> = {};
        styleFields.forEach(field => {
          if (editingBlockContent[field] !== undefined) {
            styleContent[field] = editingBlockContent[field];
          }
        });

        if (Object.keys(styleContent).length > 0) {
          await fetch(`/api/website/pages/${page?.id}/blocks/${blockId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: styleContent })
          });
        }
      }

      // Update local state
      setBlocks(blocks.map(b =>
        b.id === blockId ? { ...b, content: editingBlockContent as WebsiteBlock['content'] } : b
      ));
      setExpandedBlockId(null);
      setEditingBlockContent(null);
    } catch (error) {
      logger.error({ err: error }, 'Failed to save block content');
    } finally {
      setSavingBlock(false);
    }
  };

  const updateBlockField = (field: string, value: unknown) => {
    // Use functional update to avoid stale closure issues with async operations (like file uploads)
    setEditingBlockContent(prev => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  };

  // Handle testimonial enhancement with AI
  const handleEnhanceTestimonial = async (index: number) => {
    if (!editingBlockContent) return;
    const testimonials = (editingBlockContent.testimonials as TestimonialItem[]) || [];
    const testimonial = testimonials[index];
    if (!testimonial?.quote?.trim()) return;

    try {
      setEnhancingTestimonial(true);
      setEnhancingTestimonialIndex(index);
      setAiWritingUnavailable(null);

      const response = await fetch('/api/website/enhance-testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: testimonial.quote,
          language: settingsForm.website_language || 'en'
        })
      });

      const data = await response.json();
      if (data.success && data.enhancedQuote) {
        const updatedTestimonials = [...testimonials];
        updatedTestimonials[index] = {
          ...testimonial,
          quote: data.enhancedQuote
        };
        setEditingBlockContent({
          ...editingBlockContent,
          testimonials: updatedTestimonials
        });
      } else if (data.code === 'ai_unavailable') {
        // Switched off (Layer 2 FR-14). The owner's own wording stands.
        logger.info({ index }, 'Testimonial enhancement is switched off');
        setAiWritingUnavailable(expandedBlockId);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to enhance testimonial');
    } finally {
      setEnhancingTestimonial(false);
      setEnhancingTestimonialIndex(null);
    }
  };

  // Add a new section/block to the page
  const handleAddSection = async (blockType: string) => {
    if (!page) return;

    /*
     * Guarded here as well as in the picker.
     *
     * The tile is disabled, but a handler that trusts its own UI is one
     * refactor from writing a second block of a type the page already has —
     * and the cost of that is two elements sharing one anchor id, which breaks
     * menu navigation silently rather than loudly.
     */
    if (blocks.some(b => b.block_type === blockType)) return;

    try {
      setAddingSection(true);

      // Get default content for the block type
      const defaultContent = getDefaultBlockContent(blockType);

      // Calculate position (add at end)
      const maxPosition = Math.max(...blocks.map(b => b.position), -1);

      const response = await fetch(`/api/website/pages/${page.id}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: blockType,
          content: defaultContent,
          position: maxPosition + 1,
          enabled: true
        })
      });

      const data = await response.json();
      if (data.success && data.block) {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * A NEW SECTION GOES ABOVE THE FOOTER, NEVER BELOW IT.
         *
         * Blocks were appended at `maxPosition + 1`, which on any real page is
         * after the footer — so adding Testimonials put them under the
         * copyright line. The footer closes the page by definition; nothing
         * belongs after it.
         *
         * ─────────────────────────────────────────────────────────────────────
         * WHY THIS MOVES ONE BLOCK AND NOT THE WHOLE PAGE
         *
         * The first version of this called the REORDER endpoint, which rewrites
         * every row on the page: all of them to negative positions, then
         * 0..n-1, then a rescue pass for any it missed. Three passes, no
         * transaction, and it depends on an RPC (`clear_block_positions`) that
         * exists in no migration — so it has always run the un-guarded
         * fallback. Adding a section is not worth putting every other block on
         * the page through that, and a footer went missing in exactly this
         * window.
         *
         * Two writes now, each into a slot nothing occupies, and no other block
         * is touched at all:
         *
         *   the new block  lands at maxPosition + 1  (free: it is past the end)
         *   the footer     moves to maxPosition + 2  (free for the same reason)
         *
         * The unique index on (page_id, position) means a mistake here fails
         * loudly instead of overwriting a row. The gap left where the footer
         * used to sit is harmless — order is decided by comparing positions,
         * never by them being contiguous.
         */
        const footer = blocks.find(b => b.block_type === 'footer');
        const footerPosition = maxPosition + 2;

        /*
         * The footer's NEW position goes into local state, not its old one.
         *
         * This kept the footer object exactly as it was loaded while moving the
         * real row on the server, so `blocks` carried a stale position — and
         * the next add computed `maxPosition` from that stale number, asked for
         * a slot the footer already occupied, and the insert failed on the
         * unique index with "Key (page_id, position)=(…, 13) already exists".
         * Adding one section worked; adding a second never did.
         */
        const ordered = footer
          ? [...blocks.filter(b => b.id !== footer.id), data.block, { ...footer, position: footerPosition }]
          : [...blocks, data.block];

        setBlocks(ordered);
        setShowAddSectionModal(false);

        if (footer) {
          try {
            const moved = await fetch(`/api/website/pages/${page.id}/blocks/${footer.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ position: footerPosition })
            });
            const result = await moved.json();
            if (!result.success) {
              logger.warn({ error: result.error, blockType }, 'Added a section but could not move the footer below it');
              /*
               * Put the footer's real position back in state. Claiming a move
               * that did not happen is what produced the collision above, one
               * add later.
               */
              setBlocks(prev => prev.map(b => (b.id === footer.id ? { ...b, position: footer.position } : b)));
            }
          } catch (moveError) {
            /*
             * Not fatal, and deliberately not retried. The section exists and
             * is on screen in the right place; the worst case is that it sits
             * after the footer on the next load, which is the behaviour this
             * replaced rather than a new breakage.
             */
            logger.warn({ err: moveError, blockType }, 'Added a section but could not move the footer below it');
            setBlocks(prev => prev.map(b => (b.id === footer.id ? { ...b, position: footer.position } : b)));
          }
        }
      }
    } catch (error) {
      logger.error({ err: error, blockType }, 'Failed to add section');
    } finally {
      setAddingSection(false);
    }
  };

  // Get default content for a new block
  const getDefaultBlockContent = (blockType: string): Record<string, unknown> => {
    const defaults: Record<string, Record<string, unknown>> = {
      hero: { headline: 'Welcome', subheadline: 'Your professional service', cta_text: 'Get Started', cta_link: '#contact' },
      services: { title: 'Services', subtitle: 'What we offer', services: [], layout: 'grid' },
      cta: { title: 'Ready to Get Started?', subtitle: 'Contact us today', cta_text: 'Contact Us', cta_link: '#contact' },
      testimonials: { title: 'Testimonials', testimonials: [] },
      contact_form: { title: 'Contact Us', fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'email', type: 'email', label: 'Email', required: true }, { name: 'phone', type: 'tel', label: 'Phone', required: true }, { name: 'message', type: 'textarea', label: 'Message', required: true }] },
      intake_form: { title: 'Get Started', description: 'Fill out this form to begin', fields: [] },
      pricing: { title: 'Pricing', plans: [] },
      faq: { title: 'Frequently Asked Questions', items: [] },
      about: { title: 'About', about_text: '' },
      features: { title: 'Features', subtitle: '', features: [] },
      stats: { title: 'Our Impact', stats: [] },
      booking_widget: { title: 'Book an Appointment', mode: 'button', button_text: 'Book Now' },
      payment_button: { title: 'Make a Payment', button_text: 'Pay Now', amount: 0 },
      team: { title: 'Our Team', members: [] },
      process: { title: 'How It Works', steps: [], flow: ['booking', 'confirmation'] },
      gallery: { title: 'Gallery', images: [], layout: 'grid' },
      newsletter: { title: 'Stay Updated', description: 'Subscribe to our newsletter', button_text: 'Subscribe' },
      logo_cloud: { title: 'Trusted By', logos: [] },
      video: { title: '', video_url: '' }
    };
    return defaults[blockType] || {};
  };

  // Fetch enrichment summary to show what data is available
  const fetchEnrichmentSummary = async () => {
    if (!page) return;
    try {
      const response = await fetch(`/api/website/pages/${page.id}/enrich`);
      const data = await response.json();
      if (data.success) {
        setEnrichmentSummary(data.summary);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch enrichment summary');
    }
  };

  // Sync blocks with real business data
  const handleSyncWithBusinessData = async () => {
    if (!page) return;

    try {
      setSyncing(true);
      setSyncResult(null);

      const response = await fetch(`/api/website/pages/${page.id}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (data.success) {
        // Refresh blocks to show updated content (from central store)
        const blocksResponse = await fetch(`/api/website/pages/${page.id}/blocks-with-content`);
        const blocksData = await blocksResponse.json();
        if (blocksData.success) {
          const newBlocks = blocksData.blocks || [];
          setBlocks(newBlocks);

          // Update editingBlockContent if the currently expanded block was enriched
          if (expandedBlockId && editingBlockContent) {
            const updatedBlock = newBlocks.find((b: { id: string }) => b.id === expandedBlockId);
            if (updatedBlock) {
              setEditingBlockContent(updatedBlock.content as Record<string, unknown>);
            }
          }
        }

        setSyncResult({
          count: data.enriched_count,
          message: data.enriched_count > 0
            ? labels.sync_success.replace('{count}', data.enriched_count.toString())
            : labels.sync_no_data
        });

        // Clear result after 3 seconds
        setTimeout(() => setSyncResult(null), 3000);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to sync with business data');
    } finally {
      setSyncing(false);
    }
  };

  // Reset block order to defaults (Hero, Services, Process, About, etc.)
  /**
   * A page with no footer block gets one back.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS A REPAIR AND NOT A FEATURE
   *
   * Every recipe in `lib/website-builder/recipes.ts` ends with `footer`, and
   * `orderByRecipe` treats it as the boundary that new sections are inserted
   * ABOVE. A page without one is not a page that chose to have no footer — it
   * is a page missing the section that defines its end, and the symptom is the
   * one that showed up here: no footer row in the section list, so no way to
   * reach the logo switch, the credit line or anything else the footer holds.
   *
   * Created on load rather than offered in the Add Section dialog, because
   * nobody should have to know their page is missing its own ending in order to
   * fix it. Idempotent by construction: it only ever runs when there is no
   * footer block at all.
   *
   * Contact details, opening hours and the registered name are deliberately not
   * written here — those resolve from the business profile on every render, so
   * a repaired footer says exactly what an original one says.
   */
  const ensureRequiredBlock = async (
    pageId: string,
    pageType: string | undefined,
    blockType: 'footer' | 'process',
    loaded: WebsiteBlock[],
    /*
     * Passed in, not read from state.
     *
     * The main loader calls this in the same pass that sets `businessProfile`,
     * and React state does not update mid-function — reading it here would give
     * the previous render's value, which on first load is null. A footer
     * restored with an empty company name shows no wordmark at all.
     */
    companyName?: string | null
  ) => {
    // Landing pages carry neither of these by design: a landing page is one
    // offer on one screen, with no "how it works" and no footer.
    if (pageType === 'landing') return loaded;
    if (loaded.some(b => b.block_type === blockType)) return loaded;

    try {
      const response = await fetch(`/api/website/pages/${pageId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: blockType,
          content: blockType === 'process' ? {
            /*
             * Steps are deliberately absent. `WebsiteBlockEnrichmentService`
             * fills them on the next publish — from the business's own
             * `process_steps` when it has them, and from its capabilities when
             * it does not. Inventing steps here would put words on the page
             * that nobody wrote and that enrichment would then have to
             * second-guess.
             */
            title: language === 'he' ? 'איך זה עובד' : language === 'es' ? 'Cómo Funciona' : 'How It Works',
            services_only: false,
          } : {
            company_name: companyName || businessProfile?.company_name || '',
            copyright_year: new Date().getFullYear(),
            /*
             * The links a generated footer carries — and only to sections this
             * page actually has.
             *
             * An empty list was written here first, which quietly cost every
             * repaired footer its navigation: generation gives a footer About,
             * Services and Contact links, and a restored one arrived with none.
             * Built from the page's own blocks rather than assumed, so a page
             * with no About section does not offer a link to one.
             */
            menu_items: [
              { type: 'about', anchor: '#about', label: language === 'he' ? 'אודות' : language === 'es' ? 'Acerca de' : 'About' },
              { type: 'services', anchor: '#services', label: language === 'he' ? 'שירותים' : language === 'es' ? 'Servicios' : 'Services' },
              { type: 'contact_form', anchor: '#contact', label: language === 'he' ? 'יצירת קשר' : language === 'es' ? 'Contacto' : 'Contact' },
            ]
              .filter(item => loaded.some(b => b.block_type === item.type))
              .map(({ label, anchor }) => ({ label, anchor })),
            show_logo: true,
            show_powered_by: false
          },
          position: Math.max(...loaded.map(b => b.position), -1) + 1,
          enabled: true
        })
      });

      const data = await response.json();
      if (data.success && data.block) {
        logger.info({ pageId, blockType }, 'Restored a missing required block');
        return [...loaded, data.block];
      }

      logger.warn({ pageId, blockType, error: data.error }, 'Could not restore a missing required block');
    } catch (error) {
      // Non-fatal: the page still edits, it simply still has no footer. Worth a
      // log because a page repeatedly failing to gain one is a real defect.
      logger.warn({ err: error, pageId, blockType }, 'Could not restore a missing required block');
    }

    return loaded;
  };

  const handleResetBlockOrder = async () => {
    if (!page) return;

    try {
      setResettingOrder(true);

      const response = await fetch(`/api/website/pages/${page.id}/reset-block-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.success) {
        // Refresh blocks with new order
        setBlocks(data.blocks || []);
        setSyncResult({
          count: data.blocks?.length || 0,
          message: language === 'he' ? 'סדר החלקים אופס' : language === 'es' ? 'Orden restablecido' : 'Order reset'
        });
        setTimeout(() => setSyncResult(null), 3000);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to reset block order');
    } finally {
      setResettingOrder(false);
    }
  };

  // DnD sensors for block reordering
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Handle block drag end - reorder blocks
  const handleBlockDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !page) return;

    // Get filtered and sorted blocks (excluding process block for drag UI)
    const sortedBlocks = blocks.sort((a, b) => a.position - b.position);

    const oldIndex = sortedBlocks.findIndex(b => b.id === active.id);
    const newIndex = sortedBlocks.findIndex(b => b.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder the draggable blocks
    const reorderedBlocks = arrayMove(sortedBlocks, oldIndex, newIndex);

    // Get process block (if exists) - insert it after services block
    const processBlock = blocks.find(b => b.block_type === 'process');

    // Build complete block list with process block inserted after services
    const allBlocksReordered: typeof blocks = [];
    let position = 0;

    for (const block of reorderedBlocks) {
      allBlocksReordered.push({ ...block, position: position++ });

      // Insert process block right after services
      if (block.block_type === 'services' && processBlock) {
        allBlocksReordered.push({ ...processBlock, position: position++ });
      }
    }

    // If process block exists but services block wasn't found, add it at the end
    if (processBlock && !reorderedBlocks.some(b => b.block_type === 'services')) {
      allBlocksReordered.push({ ...processBlock, position: position++ });
    }

    // Update state immediately for smooth UX
    setBlocks(allBlocksReordered);

    // Save to backend - send ALL block IDs in correct order
    try {
      const allBlockIds = allBlocksReordered.map(b => b.id);
      const response = await fetch(`/api/website/pages/${page.id}/blocks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block_ids: allBlockIds })
      });

      if (!response.ok) {
        // Revert on error
        await fetchData();
        logger.error('Failed to reorder blocks');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to reorder blocks');
      await fetchData();
    }
  };

  // Generate content with AI for a specific field
  const handleGenerateWithAI = async (blockId: string, field: string, _prompt: string) => {
    setGeneratingAI(`${blockId}-${field}`);
    // Cleared on every attempt: a stale "unavailable" beside a button that has
    // just worked would be worse than no message at all.
    setAiWritingUnavailable(null);
    try {
      const block = blocks.find(b => b.id === blockId);
      if (!block) {
        logger.error({ blockId }, 'Block not found for AI generation');
        return;
      }

      // Use the per-field regeneration API with WebsiteAIContentService
      const response = await fetch(`/api/website/blocks/${blockId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          blockType: block.block_type,
          language: settingsForm.website_language || 'en',
          context: {
            businessName: businessProfile?.company_name,
            vertical: businessProfile?.vertical,
            existingContent: editingBlockContent
          }
        })
      });

      const data = await response.json();
      if (data.success && data.value) {
        updateBlockField(field, data.value);
      } else if (data.code === 'ai_unavailable') {
        // Switched off, not broken (Layer 2 FR-14). Their field is untouched.
        logger.info({ blockId, field }, 'AI writing is switched off');
        setAiWritingUnavailable(blockId);
      } else if (data.error) {
        logger.error({ error: data.error, blockId, field }, 'AI generation failed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate AI content');
    } finally {
      setGeneratingAI(null);
    }
  };

  // Save website settings
  const handleSaveSettings = async () => {
    if (!page) return;

    try {
      setSaving(true);
      setSaveMessage(null);

      const updates: Record<string, unknown> = {
        title: settingsForm.title,
        meta_description: settingsForm.meta_description,
        favicon_url: settingsForm.favicon_url || null,
        website_language: settingsForm.website_language
      };

      // Include subdomain if it changed (auto-generated from company name or manually entered)
      if (subdomain && subdomain !== page.subdomain) {
        updates.subdomain = subdomain;
      }

      logger.info({ pageId: page.id, updates }, 'Saving settings');

      const response = await fetch(`/api/website/pages/${page.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (data.success && data.page) {
        setPage(data.page);
        // Update settingsForm with saved values to ensure sync
        setSettingsForm(prev => ({
          ...prev,
          website_language: data.page.website_language || prev.website_language
        }));
        setSaveMessage({ type: 'success', text: language === 'he' ? 'נשמר בהצלחה!' : language === 'es' ? 'Guardado!' : 'Saved!' });
        logger.info({ pageId: page.id }, 'Settings saved successfully');
        // Clear success message after 3 seconds
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save' });
        logger.error({ error: data.error, details: data.details }, 'Failed to save settings');
      }
    } catch (error) {
      setSaveMessage({ type: 'error', text: 'Network error - please try again' });
      logger.error({ err: error }, 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  /**
   * What the contact sidebar will actually show for a field left blank.
   *
   * The public page fills these from the business profile, so an empty field
   * here does not mean "no phone number" — it means "use the one I already
   * gave you". Showing that value as the placeholder is the difference between
   * a form that looks unfilled and one that says what it will do.
   */
  const contactFromProfile = (column: 'email' | 'phone' | 'address'): string => {
    const profile = businessProfile as unknown as Record<string, unknown> | null;
    const value = profile?.[column];
    return typeof value === 'string' && value.trim() ? value : '';
  };

  /**
   * When this business is open, shown but not edited here.
   *
   * Typed into the block, opening hours are a claim that goes stale silently:
   * the owner changes their availability, the booking calendar moves, and this
   * section goes on telling clients to come on a day nobody is working. Derived
   * from `scheduling_availability`, there is one answer and it moves with the
   * calendar — which is also why the footer below can state the same hours
   * without the two disagreeing.
   */
  /**
   * The website's own brand colour, for controls that speak about the website.
   *
   * The saved theme first, the design form second: while an owner is choosing a
   * colour the form is ahead of the row, and a switch that only catches up
   * after a save reads as broken.
   */
  const renderProfileHours = () => {
    const rows = openingHoursRows(businessProfile?.scheduling_availability, language);

    return (
      <div
        className="p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] space-y-2"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        {rows.length > 0 ? (
          rows.map(row => (
            <div key={row.days} className="flex items-baseline gap-3 text-sm">
              <span className="w-20 shrink-0 text-[var(--v2-text-muted)]">{row.days}</span>
              <span className="text-[var(--v2-text-primary)]" dir="ltr">{row.hours}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--v2-text-muted)] italic">
            {language === 'he'
              ? 'טרם הוגדרו שעות פעילות.'
              : language === 'es'
                ? 'Aún no has definido tu disponibilidad.'
                : 'No availability set yet.'}
          </p>
        )}

        <button
          type="button"
          /* Silent: the owner is standing in the block editor looking at
             these values, and dropping the whole page to a spinner to
             collect one changed field loses their place and reads as the
             edit having gone wrong. The values update underneath them. */
          onClick={() => openConfiguration('availability', { onClose: () => fetchData({ silent: true }) })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {language === 'he'
            ? 'עריכת שעות הפעילות'
            : language === 'es'
              ? 'Editar disponibilidad'
              : 'Edit availability'}
          <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
        </button>
      </div>
    );
  };

  /**
   * How to reach this business, shown but not edited here.
   *
   * These were three editable inputs, in the contact block AND again in the
   * footer — two places to type a phone number onto one page, with no way for a
   * visitor to tell which of the two was real. The public pages now read all
   * three from the business profile and nothing else, so leaving editable boxes
   * here would promise an override that no longer happens.
   *
   * Shown rather than hidden: "where does this come from?" is the first
   * question an owner asks of a footer they cannot edit, and the answer has to
   * be on screen next to the values, with the way to change them.
   *
   * A render function rather than a component so it does not remount — and so
   * it can read `businessProfile` and `language` straight from the closure.
   */
  const renderProfileContactFields = () => {
    const rows: Array<{ label: string; value: string; ltr?: boolean }> = [
      {
        // Shown first: it is the name the footer signs the copyright with, and
        // the one people most expect to be able to change from here.
        label: language === 'he' ? 'שם העסק' : language === 'es' ? 'Nombre' : 'Business name',
        value: businessProfile?.company_name || '',
      },
      {
        label: language === 'he' ? 'אימייל' : language === 'es' ? 'Email' : 'Email',
        value: contactFromProfile('email'),
        ltr: true,
      },
      {
        label: language === 'he' ? 'טלפון' : language === 'es' ? 'Teléfono' : 'Phone',
        value: contactFromProfile('phone'),
        ltr: true,
      },
      {
        label: language === 'he' ? 'כתובת' : language === 'es' ? 'Dirección' : 'Address',
        value: contactFromProfile('address'),
      },
    ];

    const missing =
      language === 'he' ? 'לא הוגדר' : language === 'es' ? 'Sin definir' : 'Not set';

    return (
      <div
        className="p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] space-y-2"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <p className="text-xs text-[var(--v2-text-muted)]">
          {language === 'he'
            ? 'פרטי הקשר מגיעים מפרופיל העסק, כך שהם זהים בכל העמודים.'
            : language === 'es'
              ? 'Los datos de contacto vienen del perfil del negocio, para que sean los mismos en todas las páginas.'
              : 'Contact details come from your business profile, so they are the same on every page.'}
        </p>

        {rows.map(row => (
          <div key={row.label} className="flex items-baseline gap-3 text-sm">
            {/*
              Wide enough for the longest label, and never allowed to wrap.
              ───────────────────────────────────────────────────────────────
              This was `w-20` — 80px — while "Business name" needs about 95,
              so the label that matters most broke across two lines and sat
              beside a value on one, which reads as two different rows.

              Sized for English because it is the longest of the three here;
              the value beside it is what gives way, since an address is
              expected to run on and a field name is not.
            */}
            <span className="w-28 shrink-0 whitespace-nowrap text-[var(--v2-text-muted)]">{row.label}</span>
            <span
              className={`min-w-0 break-words ${row.value ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)] italic'}`}
              dir={row.ltr && row.value ? 'ltr' : undefined}
            >
              {row.value || missing}
            </span>
          </div>
        ))}

        <button
          type="button"
          /* Silent: the owner is standing in the block editor looking at
             these values, and dropping the whole page to a spinner to
             collect one changed field loses their place and reads as the
             edit having gone wrong. The values update underneath them. */
          onClick={() => openConfiguration('business', { onClose: () => fetchData({ silent: true }) })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {language === 'he'
            ? 'עריכה בפרופיל העסק'
            : language === 'es'
              ? 'Editar en el perfil del negocio'
              : 'Edit in business profile'}
          <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
        </button>
      </div>
    );
  };

  // Save design settings
  const handleSaveDesign = async () => {
    try {
      setSavingDesign(true);
      setSaveMessage(null);

      const theme: PageTheme = {
        colors: {
          primary: designForm.primaryColor,
          secondary: designForm.secondaryColor,
          accent: page?.theme?.colors?.accent || '#EC4899',
          background: page?.theme?.colors?.background || '#FFFFFF',
          surface: page?.theme?.colors?.surface || '#F9FAFB',
          text: page?.theme?.colors?.text || '#111827',
          textSecondary: page?.theme?.colors?.textSecondary || '#6B7280'
        },
        /*
         * The chosen face, on the Hebrew pages too.
         *
         * `completeTheme` fills an absent `hebrewHeading` from the ARCHETYPE's
         * stand-in, and `PublicThemeStyle` prefers that stand-in whenever the
         * page is Hebrew. So a business on Bloom that chose Rubik — a face with
         * full Hebrew — kept rendering Varela Round on every Hebrew page, which
         * is to say the choice had no visible effect on the only pages that
         * business serves.
         *
         * Stated explicitly here, one way or the other: a face that carries
         * Hebrew sets itself as the Hebrew face and beats the stand-in; a face
         * that does not leaves the field absent, and the archetype's stand-in
         * is then exactly right — falling back to a system face would be worse
         * than the substitution it exists to prevent.
         */
        fonts: {
          heading: designForm.headingFont,
          body: designForm.bodyFont,
          hebrewHeading: carriesHebrew(designForm.headingFont) ? designForm.headingFont : undefined,
          hebrewBody: carriesHebrew(designForm.bodyFont) ? designForm.bodyFont : undefined
        },
        borderRadius: page?.theme?.borderRadius || '0.5rem',
        spacing: page?.theme?.spacing || 'normal'
      };

      // The business's look, saved whether or not there is a website. This
      // used to return early without a page, so the businesses with the most
      // need of it — reaching clients by link — could not set one at all,
      // while their invoices and emails read the same theme.
      await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });

      if (!page) {
        setSaveMessage({
          type: 'success',
          text: language === 'he' ? 'נשמר בהצלחה!' : language === 'es' ? 'Guardado!' : 'Saved!'
        });
        setTimeout(() => setSaveMessage(null), 3000);
        setSavingDesign(false);
        return;
      }

      logger.info({ pageId: page.id, theme }, 'Saving design settings');

      const response = await fetch(`/api/website/pages/${page.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });

      const data = await response.json();

      if (data.success && data.page) {
        setPage(data.page);
        setSaveMessage({ type: 'success', text: language === 'he' ? 'העיצוב נשמר!' : language === 'es' ? '¡Diseño guardado!' : 'Design saved!' });
        logger.info({ pageId: page.id }, 'Design saved successfully');
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save design' });
        logger.error({ error: data.error }, 'Failed to save design');
      }
    } catch (error) {
      setSaveMessage({ type: 'error', text: 'Network error - please try again' });
      logger.error({ err: error }, 'Failed to save design');
    } finally {
      setSavingDesign(false);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    try {
      setLoading(true);
      logger.info({ templateId }, 'Creating website from template');

      const response = await fetch('/api/website/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          page_type: 'homepage',
          title: 'My Website'
        })
      });

      const data = await response.json();
      logger.info({ response: data, status: response.status }, 'Create page response');

      if (data.success && data.page) {
        setPage(data.page);
        setViewMode('overview');
        // Fetch blocks for new page (with content from central store)
        const blocksResponse = await fetch(`/api/website/pages/${data.page.id}/blocks-with-content`);
        const blocksData = await blocksResponse.json();
        if (blocksData.success) {
          setBlocks(blocksData.blocks || []);
        }
      } else {
        logger.error({ error: data.error, details: data.details }, 'Failed to create page from template');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create website from template');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Unselect the current template — back to no choice made.
   *
   * Clicking the selected one was inert. But a template is a decision, and a
   * business that has made the wrong one should be able to take it back rather
   * than be forced to pick a different wrong one. Both profile columns are
   * cleared; pages keep the theme they were built with, because clearing a
   * choice is not the same as undoing what was made from it.
   */
  /**
   * Re-read which template the business wears.
   *
   * Creating a landing page or a website can ESTABLISH the template — the first
   * surface wins — so the Templates tab has to be told, or it goes on showing
   * nothing selected until the next full page load.
   */
  const refreshBusinessTemplate = async () => {
    try {
      const response = await fetch('/api/business-os/business-template');
      const data = await response.json();
      if (data.success) setCurrentTemplateId(data.templateId ?? null);
    } catch (err) {
      logger.warn({ err }, 'Could not re-read the business template');
    }
  };

  const handleClearTemplate = async () => {
    try {
      setApplyingTemplate(true);
      const response = await fetch('/api/business-os/business-template', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The server refuses while pages are built from it; say which it is.
        setGenerationNotice({
          kind: 'error',
          message: data?.reason === 'in_use' ? labels.template_in_use : labels.template_change_failed,
        });
        return;
      }
      setCurrentTemplateId(null);
    } catch (error) {
      logger.error({ err: error }, 'Failed to clear the business template');
      setGenerationNotice({ kind: 'error', message: labels.template_change_failed });
    } finally {
      setApplyingTemplate(false);
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    /*
     * Without a website, this returned here and the Templates tab did nothing
     * at all — no page, no request, no message. But a template is the
     * BUSINESS's look: it dresses the landing pages, the smart links, the
     * invoice PDF and every transactional email, none of which need a website
     * to exist. A business reaching clients by link had no way to choose one.
     *
     * With no page there is nothing to apply a template TO, so this records the
     * choice on the business instead, and the next surface it creates is built
     * from it.
     */
    if (!page) {
      try {
        setApplyingTemplate(true);
        const response = await fetch('/api/business-os/business-template', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: templateId })
        });
        if (!response.ok) {
          setGenerationNotice({ kind: 'error', message: labels.template_change_failed });
          return;
        }
        // Silent, the same as the path below. A full reload here dropped the
        // gallery to a spinner and came back with the tab reset, which reads as
        // the choice having failed.
        await fetchData({ silent: true });
      } catch (error) {
        logger.error({ err: error, templateId }, 'Failed to set the business template');
        setGenerationNotice({ kind: 'error', message: labels.template_change_failed });
      } finally {
        setApplyingTemplate(false);
      }
      return;
    }

    try {
      setApplyingTemplate(true);
      logger.info({ templateId, pageId: page.id }, 'Applying template to existing page');

      const response = await fetch(`/api/website/pages/${page.id}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId })
      });

      const data = await response.json();
      logger.info({ response: data, status: response.status }, 'Apply template response');

      if (data.success && data.page) {
        setPage(data.page);
        // The route applies this business-wide, so the tab's mark follows it.
        setCurrentTemplateId(templateId);

        /*
         * Stay where the choosing happens.
         *
         * This jumped to the overview the moment a template was applied, so
         * changing one's mind meant navigating back to the gallery every time —
         * and comparing two looks meant doing that round trip for each. Nobody
         * picks a template once. The tab already marks the current choice, so
         * staying put shows the result and leaves the alternatives in reach.
         */

        /*
         * Everything else this page shows, refreshed without a spinner.
         *
         * This used to re-fetch only the open page's blocks, but the route
         * applies the template BUSINESS-WIDE: every landing page in `allPages`
         * is now wearing a look the list still described with the old one, and
         * the theme behind the section previews was the old theme until
         * something else happened to reload. Silent because the gallery has
         * already shown the owner their new choice — dropping the editor to a
         * spinner to confirm it reads as a failure, and loses the scroll
         * position on a long page.
         */
        await fetchData({ silent: true });
      } else {
        logger.error({ error: data.error, details: data.details }, 'Failed to apply template');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to apply template');
    } finally {
      setApplyingTemplate(false);
    }
  };

  /**
   * Whether a specific page is open for editing, rather than just loaded.
   *
   * The website's homepage sits in `page` from the moment this screen opens —
   * the overview card reads from it — so "is there a page?" is not the same
   * question as "is the owner inside one?". The editing views are the answer:
   * sections, design and settings all act on one page, while the overview and
   * the template gallery are about the whole online presence.
   */
  const editingPage = Boolean(page) && ['sections', 'design', 'settings'].includes(viewMode);

  const getWebsiteUrl = () => {
    if (page?.subdomain) {
      return `https://${page.subdomain}.agentpilot.io`;
    }
    return null;
  };

  const getPreviewUrl = () => {
    if (page?.id) {
      // `lang` so the preview's own chrome (loading, errors) speaks the
      // platform's language rather than the browser's.
      return `/website-preview/${page.id}?lang=${language}`;
    }
    return null;
  };

  // Block display names
  const getBlockName = (blockType: string): string => {
    const names: Record<string, Record<string, string>> = {
      header: { en: 'Header', es: 'Encabezado', he: 'כותרת עליונה' },
      hero: { en: 'Hero', es: 'Sección Principal', he: 'כותרת ראשית' },
      services: { en: 'Services', es: 'Servicios', he: 'שירותים' },
      cta: { en: 'Call to Action', es: 'Llamada a la Acción', he: 'קריאה לפעולה' },
      testimonials: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
      contact_form: { en: 'Contact Form', es: 'Formulario de Contacto', he: 'טופס יצירת קשר' },
      pricing: { en: 'Pricing', es: 'Precios', he: 'מחירון' },
      faq: { en: 'FAQ', es: 'Preguntas Frecuentes', he: 'שאלות נפוצות' },
      about: { en: 'About', es: 'Acerca de', he: 'אודות' },
      features: { en: 'Features', es: 'Características', he: 'תכונות' },
      booking_widget: { en: 'Booking', es: 'Reservas', he: 'הזמנת תור' },
      payment_button: { en: 'Payment', es: 'Pago', he: 'תשלום' },
      team: { en: 'Team', es: 'Equipo', he: 'צוות' },
      process: { en: 'Booking Flow', es: 'Flujo de Reserva', he: 'תהליך הזמנה' },
      gallery: { en: 'Gallery', es: 'Galería', he: 'גלריה' },
      newsletter: { en: 'Newsletter', es: 'Boletín', he: 'ניוזלטר' },
      video: { en: 'Video', es: 'Video', he: 'וידאו' },
      stats: { en: 'Statistics', es: 'Estadísticas', he: 'סטטיסטיקות' },
      footer: { en: 'Footer', es: 'Pie de página', he: 'כותרת תחתונה' },
      intake_form: { en: 'Intake Form', es: 'Formulario de Admisión', he: 'טופס קליטה' }
    };
    return names[blockType]?.[language] || names[blockType]?.en || blockType;
  };

  // Helper to get template primary color (supports both data structures)
  const getTemplatePrimaryColor = (template: WebsiteTemplate): string => {
    return template.theme?.primary_color || template.theme?.colors?.primary || '#4F6EF7';
  };

  const getTemplateSecondaryColor = (template: WebsiteTemplate): string => {
    return template.theme?.secondary_color || template.theme?.colors?.secondary || '#6366F1';
  };

  const getBlockIcon = (blockType: string): LucideIcon => {
    const icons: Record<string, LucideIcon> = {
      header: Globe,
      hero: Target,
      services: List,
      cta: Megaphone,
      testimonials: MessageCircle,
      contact_form: Mail,
      pricing: DollarSign,
      faq: HelpCircle,
      about: User,
      features: Sparkles,
      booking_widget: Calendar,
      payment_button: CreditCard,
      team: Users,
      process: RotateCcw,
      gallery: ImageIcon,
      newsletter: Newspaper,
      video: Video,
      stats: BarChart3
    };
    return icons[blockType] || Package;
  };

  /**
   * Landing pages and smart links.
   *
   * Extracted so it can render whether or not a website page exists. It lived
   * inside the `page &&` branch, which meant a business with no website saw
   * none of it — and for a business that declined a website during onboarding,
   * this IS their online presence. It reads nothing off `page`.
   */
  const renderLeadGeneration = () => (
    <>
      {/* Row 2: Lead Generation Section (Landing Pages + Lead Capture) */}
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(139, 92, 246, 0.12)' }}>
              <Megaphone className="w-5 h-5" style={{ color: '#8B5CF6' }} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                {labels.landing_pages}
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)]">
                {labels.landing_pages_desc}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLandingPageWizard(true)}
              className="flex items-center gap-2 px-4 py-2 text-[#4F6EF7] text-sm font-medium border border-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Plus className="h-4 w-4" />
              {labels.create_landing_page}
            </button>
          </div>
        </div>

        {/*
          Combined Landing Pages & Smart Links, as CARDS.
          ─────────────────────────────────────────────────────────────────────
          Full-width rows made every entry look alike and read as a settings
          table: the name, the address and the figures ran along one line, so
          scanning for "my booking link" meant reading left to right through
          each row in turn. These are things the owner hands out — a card per
          one is the shape that matches how they think about them.

          Two columns from `lg`, one below it. Not three: the address and the
          view counts need the width, and a third column turns both back into
          the cramped line this replaces.
        */}
        <div className="flex flex-col gap-2.5">
          {/* Smart Links */}
          {/*
            Every link, whatever its state.

            Inactive ones used to be filtered out behind a toggle, so
            deactivating a link made it DISAPPEAR — indistinguishable from
            deleting it, and leaving the owner no way back to the thing they had
            just switched off. The "Inactive" badge and the Activate button on
            the row are what tell the two states apart; hiding the row said
            something stronger and untrue.
          */}
          {smartLinks.map((link) => (
            <div
              key={`smart-${link.id}`}
              /*
                The row the notice above is pointing at, marked.

                Text alone leaves the owner scanning two lists for "my booking
                link" — the notice names the thing and the page shows it among
                others that look identical. Only the BOOKING link is marked,
                and only while the notice is actually asking for it: a
                highlight that is always on is decoration, and decoration
                cannot direct anybody anywhere.
              */
              className={`p-4 bg-[var(--v2-bg)] rounded-lg border transition-shadow ${
                link.destination_type === 'booking' && !link.is_active &&
                (presenceGuidance.state === 'activate_link' || presenceGuidance.alsoActivateLink)
                  ? `border-[#4F6EF7] ring-2 ring-[#4F6EF7]/30${prefersReducedMotion ? '' : ' ap-attention'}`
                  : !link.is_active
                    ? 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-900/10'
                    : 'border-[var(--v2-border)]'
              }`}
            >
              {/* Why this link will not switch on. Named against the link
                  itself, because the gap is in the journey THIS link sells —
                  a service asking for a time with no hours set, or for a card
                  with no processor connected. */}
              {smartLinkNotice?.id === link.id && (
                <div className="mb-3 space-y-2">
                  {smartLinkNotice.gaps.length > 0 ? (
                    smartLinkNotice.gaps.map(gap => {
                      const isInvoicing = gap.kind === 'invoicing';
                      const GapIcon = isInvoicing ? FileText : Clock;
                      return (
                        <div
                          key={gap.kind}
                          className="flex items-start gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)]"
                          style={{ borderRadius: 'var(--v2-radius-card)' }}
                        >
                          <div
                            className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <GapIcon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[var(--v2-text-primary)]">{gap.message}</p>
                            <button
                              type="button"
                              onClick={() =>
                                openConfiguration(isInvoicing ? 'invoice' : 'availability', {
                                  // Cleared rather than re-asked: activation is a
                                  // deliberate click, and it answers freshly.
                                  onClose: () => setSmartLinkNotice(null),
                                })
                              }
                              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {isInvoicing
                                ? labels.publish_fix_invoicing
                                : labels.publish_fix_availability}
                              <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p
                      className="px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      role="status"
                    >
                      {smartLinkNotice.message}
                    </p>
                  )}
                </div>
              )}
              {/* Content and stats side by side; the refusal notice above stays
                  full width, because it is about the link rather than a reading
                  of it. The stats lead — left in English, right in Hebrew — and
                  the side is chosen because the document is dir="ltr". */}
              {/* Stacked on a phone, side by side from `sm`.
                  Squeezing the analytics card in beside the name left both
                  columns too narrow to read — the link's own address wrapped
                  mid-word while the figures beside it had nowhere to go. The
                  direction swap only applies once there are two columns to
                  swap. */}
              {/*
                Stacked, always.
                ─────────────────────────────────────────────────────────────
                This was two columns from `sm` with the stats leading. Inside a
                card that is half the page wide, two columns leaves neither
                enough room — the link's own address wrapped mid-word while the
                figures beside it had nowhere to go. The card gives the vertical
                space the row never had, so the direction swap is gone with it:
                there is only one column to order.
              */}
              {/*
                One row: who it is, how it is doing, what you can do with it.
                ─────────────────────────────────────────────────────────────
                The figures sit in fixed columns at the end, so they line up
                down the page and compare at a glance — the thing a grid of
                cards cannot do, because each card starts its numbers wherever
                its name happens to end.

                Stacked below `lg`, where there is not width for three groups.
              */}
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/*
                Identity: a FIXED column, not a flexible one.
                ─────────────────────────────────────────────────────────────
                A flexible column is as wide as its longest name, so one link
                called "Contact Form" and another called "Autumn campaign for
                returning clients" push the figures beside them to different
                places and the columns stop lining up. Fixed width and a
                truncating name keep every row identical whatever it is called.
              */}
              <div className="min-w-0 lg:w-[260px] shrink-0">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${!link.is_active ? 'opacity-50' : ''}`} style={{ backgroundColor: '#4F6EF720' }}>
                    <Link2 className="w-5 h-5" style={{ color: '#4F6EF7' }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className={`truncate font-medium ${!link.is_active ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                        {link.name === 'Contact Form'
                          ? (language === 'he' ? 'טופס יצירת קשר' : language === 'es' ? 'Formulario de Contacto' : 'Contact Form')
                          : (link.name || (language === 'he' ? 'קישור חכם' : 'Smart Link'))}
                      </p>
                      {/*
                        Live or not — the same badge the landing pages carry.
                        ─────────────────────────────────────────────────────
                        This used to say "Smart Link" when active and
                        "Inactive" when not, so the badge meant two different
                        KINDS of thing depending on its state: a type when the
                        news was good, a status when it was not. An owner
                        scanning the list could not tell at a glance which links
                        were actually working, because half the rows answered a
                        question nobody asked.

                        The type is already carried by the icon and its colour.
                        What the badge is for is whether this link does anything
                        when somebody opens it — and it now says that in the
                        same colours as the landing page rows it sits beside.

                        "Inactive" rather than "Draft", though: a landing page
                        can be drafted and never published, while a smart link
                        exists and was switched OFF. Same badge, same amber,
                        different word, because they are different facts.
                      */}
                      <span
                        className={`shrink-0 whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded ${
                          link.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        {link.is_active ? labels.status_live : labels.status_inactive}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1" dir="ltr">
                      <span className={`truncate text-xs font-mono ${!link.is_active ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-muted)]'}`}>
                        /go/{link.code}
                      </span>
                    </div>
                    {/*
                      What kind of thing this is, in words.
                      ─────────────────────────────────────────────────────
                      The type badge went so the title would stop wrapping,
                      which left only the icon's colour to say whether a row is
                      a smart link or a landing page — a distinction nobody can
                      make from a blue square unless they already know.

                      Said precisely rather than generically: "Services" and
                      "Contact" are the two an owner actually has, and which
                      one a link is decides what they should write beside it
                      when they share it.
                    */}
                    <p className="truncate text-[11px] text-[var(--v2-text-muted)] mt-0.5">
                      {link.destination_type === 'form'
                        ? labels.type_contact_link
                        : link.destination_type === 'booking'
                          ? labels.type_services_link
                          : link.destination_type === 'payment'
                            ? labels.type_payment_link
                            : labels.type_smart_link}
                    </p>
                  </div>
                </div>
              </div>

              {/* ACTIONS — moved out of the identity column and pushed to the
                  end of the row, so every row's controls sit in one place
                  rather than under a name of unpredictable length. */}
              <div className="flex items-center gap-2 shrink-0 lg:ms-auto lg:order-last">
                  {/* Activate/Deactivate toggle */}
                  {!link.is_active ? (
                    <button
                      onClick={async () => {
                        setTogglingSmartLinkStatus(link.id);
                        try {
                          const response = await fetch(`/api/smart-links/${link.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active: true })
                          });
                          const data = await response.json().catch(() => ({}));
                          if (response.ok) {
                            setSmartLinkNotice(null);
                            setSmartLinks(prev => prev.map(l =>
                              l.id === link.id ? { ...l, is_active: true } : l
                            ));
                          } else {
                            // A refusal is the owner's to act on — no working
                            // hours, no card processor — so it is shown against
                            // the link rather than logged and swallowed.
                            logger.info({ linkId: link.id, reason: data.reason }, 'Smart link activation refused');
                            setSmartLinkNotice({
                              id: link.id,
                              message: data.error || (language === 'he' ? 'לא ניתן להפעיל את הקישור.' : language === 'es' ? 'No se pudo activar el enlace.' : 'This link could not be activated.'),
                              gaps: Array.isArray(data.gaps) ? data.gaps : [],
                            });
                          }
                        } catch (err) {
                          logger.error({ err }, 'Failed to activate smart link');
                        } finally {
                          setTogglingSmartLinkStatus(null);
                        }
                      }}
                      disabled={togglingSmartLinkStatus === link.id}
                      className="px-2 py-1 text-xs font-medium text-green-600 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 rounded transition-colors disabled:opacity-50"
                      title={language === 'he' ? 'הפעל' : language === 'es' ? 'Activar' : 'Activate'}
                    >
                      {togglingSmartLinkStatus === link.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        language === 'he' ? 'הפעל' : language === 'es' ? 'Activar' : 'Activate'
                      )}
                    </button>
                  ) : (
                    <>
                      {/*
                        Deactivate — the counterpart to Activate, which had none.

                        The only way to switch a link off used to be the Delete
                        button, which was a soft delete: it set `is_active:
                        false` and the row reappeared as "Inactive". One control
                        meant two things and the honest one was missing. Delete
                        now removes the link; this is how you take one offline
                        and keep its history — and it is what a link CREATED
                        inactive, because its journey cannot run yet, is waiting
                        on.
                      */}
                      <button
                        onClick={async () => {
                          setTogglingSmartLinkStatus(link.id);
                          try {
                            const response = await fetch(`/api/smart-links/${link.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ is_active: false })
                            });
                            if (response.ok) {
                              setSmartLinkNotice(null);
                              setSmartLinks(prev => prev.map(l =>
                                l.id === link.id ? { ...l, is_active: false } : l
                              ));
                            }
                          } catch (err) {
                            logger.error({ err }, 'Failed to deactivate smart link');
                          } finally {
                            setTogglingSmartLinkStatus(null);
                          }
                        }}
                        disabled={togglingSmartLinkStatus === link.id}
                        className="px-2 py-1 text-xs font-medium text-[var(--v2-text-muted)] hover:text-amber-600 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                        title={language === 'he' ? 'השבתה' : language === 'es' ? 'Desactivar' : 'Deactivate'}
                      >
                        {togglingSmartLinkStatus === link.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          language === 'he' ? 'השבתה' : language === 'es' ? 'Desactivar' : 'Deactivate'
                        )}
                      </button>

                      {/* Edit button - for booking links (full journey) or booking destination type */}
                      {(link.metadata?.journeyType === 'full' || link.destination_type === 'booking') && (
                        <button
                          onClick={() => {
                            setEditingSmartLink({
                              id: link.id,
                              name: link.name,
                              metadata: link.metadata || { journeyType: 'full' }
                            });
                            setShowLandingPageWizard(true);
                          }}
                          className="p-1.5 text-[var(--v2-text-muted)] hover:text-[#4F6EF7] transition-colors"
                          title={language === 'he' ? 'עריכה' : language === 'es' ? 'Editar' : 'Edit'}
                        >
                          <PenLine className="h-4 w-4" />
                        </button>
                      )}
                      {/*
                        Share, not a bare copy glyph.
                        ─────────────────────────────────────────────────────
                        Copying gave a link and learned nothing. The menu asks
                        where it is going — in the owner's words, never
                        "UTM" — and tags it, which is the only way a WhatsApp
                        or QR-code lead can be attributed at all: neither sends
                        a referrer. "Just copy the link" is still one click in.
                      */}
                      {/*
                        Only while the link is switched ON.
                        ───────────────────────────────────────────────────
                        An inactive smart link does not resolve — `/go/[code]`
                        answers with the unavailable page. Sharing one sends a
                        client to a dead end, and the badge beside this says
                        "Inactive" while the button offered to hand it out.
                      */}
                      {/*
                        The guide's hint, on every live smart link.
                        ─────────────────────────────────────────────────────
                        It was on the first one only, which put it on whichever
                        link the API happened to return first — the contact
                        form, as it turned out, while the booking link beside it
                        had nothing. Both are links the owner shares, and both
                        deserve the explanation.

                        `kind` decides the wording inside: a contact form shared
                        with "Book a time with me" reads as a different product.
                        Once read it retires for all of them, since the lesson
                        is the same one.

                        `=== true` because `useReducedMotion` answers null until
                        it has asked the browser, and the guide wants a yes or a
                        no.
                      */}
                      {link.is_active && (
                        <ShareGuide
                          language={language}
                          isRTL={language === 'he'}
                          shareDomain={subdomain ? `${subdomain}.agentpilot.io` : undefined}
                          kind={link.destination_type === 'form' ? 'form' : 'booking'}
                          code={link.code}
                          prefersReducedMotion={prefersReducedMotion === true}
                        />
                      )}
                      {link.is_active && (
                      <ShareMenu
                        target={{ kind: 'smart_link', code: link.code }}
                        title={link.name === 'Contact Form'
                          ? (language === 'he' ? 'טופס יצירת קשר' : language === 'es' ? 'Formulario de Contacto' : 'Contact Form')
                          : (link.name || 'Smart Link')}
                        language={language}
                        isRTL={language === 'he'}
                        compact
                      />
                      )}
                      <a
                        href={`/go/${link.code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                        title={labels.preview}
                      >
                        <Eye className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => {
                          const displayName = link.name === 'Contact Form'
                            ? (language === 'he' ? 'טופס יצירת קשר' : language === 'es' ? 'Formulario de Contacto' : 'Contact Form')
                            : (link.name || 'Smart Link');
                          setDeletingSmartLink({ id: link.id, name: displayName });
                          setDeleteSmartLinkDialogOpen(true);
                        }}
                        className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                        title={language === 'he' ? 'השבת' : language === 'es' ? 'Desactivar' : 'Deactivate'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
              </div>

              {/*
                The figures, in fixed columns at the end of the row.
                ─────────────────────────────────────────────────────────────
                They were a bordered card holding four grey tiles — three
                nested surfaces for four small numbers, and most of the visual
                weight on the page. The border, the tiles and the heading are
                gone; the numbers sit on the row itself.

                Each column is a fixed width so the figures align DOWN the
                page. That alignment is the whole argument for a row over a
                card: a reader comparing two links reads one column, not two
                card interiors.
              */}
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-2 shrink-0">
                {([
                  { value: link.click_count, label: language === 'he' ? 'קליקים' : language === 'es' ? 'Clics' : 'Clicks', muted: false },
                  { value: link.conversion_count, label: language === 'he' ? 'המרות' : language === 'es' ? 'Conversiones' : 'Conversions', muted: false },
                  { value: link.unique_visitors ?? 0, label: labels.unique_visitors, muted: false },
                  {
                    value: link.click_count > 0 ? `${((link.conversion_count / link.click_count) * 100).toFixed(0)}%` : '—',
                    label: language === 'he' ? 'אחוז המרה' : language === 'es' ? 'Tasa' : 'Rate',
                    /* Muted at zero: a rate of 0% is the absence of a reading,
                       not a reading of zero, and bolding it gives it weight it
                       has not earned. */
                    muted: link.click_count === 0,
                  },
                ] as const).map(stat => (
                  <div
                    key={stat.label}
                    /* Every tile the SAME width, and the label clipped rather
                       than allowed to widen it. "Conversions" and "Rate" differ
                       by four characters; left to themselves they would give
                       each row a different rhythm and the columns would stop
                       lining up down the page. */
                    className="w-[74px] shrink-0 rounded-lg bg-[var(--v2-bg)] px-1 py-1.5 text-center"
                  >
                    <p className={`text-[15px] font-semibold tabular-nums leading-tight ${stat.muted ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'}`}>
                      {stat.value}
                    </p>
                    <p className="truncate text-[10px] text-[var(--v2-text-muted)]" title={stat.label}>
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
              </div>
            </div>
          ))}

          {/* Landing Pages */}
          {allPages.filter(p => p.page_type === 'landing').map((p) => (
            <div
              key={p.id}
              /* `flex` so the stats card below sits at the END of the row —
                 the left in Hebrew — rather than under it. */
              className={`p-4 bg-[var(--v2-bg)] rounded-lg border flex flex-col lg:flex-row lg:items-center gap-4 transition-shadow ${
                /* A drafted landing page, while the notice is asking for one to
                   be published. Every draft is marked rather than a guessed
                   "best" one: the notice says a landing page would do it, and
                   which one is the owner's call, not ours. */
                presenceGuidance.state === 'publish_landing' && p.status !== 'live'
                  ? `border-[#4F6EF7] ring-2 ring-[#4F6EF7]/30 ${prefersReducedMotion ? '' : 'ap-attention '}`
                  : 'border-[var(--v2-border)] '
              }`}
            >
              {/* A FIXED column, the same width as the smart-link rows, so the
                  two kinds of entry line up with each other down the page. */}
              <div className="min-w-0 lg:w-[260px] shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#22C58B20' }}>
                    <FileText className="w-5 h-5" style={{ color: '#22C58B' }} />
                  </div>
                  <div className="min-w-0">
                    {/*
                      The "Landing Page" badge is gone.
                      ───────────────────────────────────────────────────────
                      It sat beside the title inside a 260px column that also
                      had to hold the icon, so the title got about 110px and
                      both wrapped to two lines.

                      It was saying what the green document icon already says —
                      the smart-link rows carry no "Smart Link" badge either,
                      because their blue link icon does that job. What the badge
                      row is FOR is the status, and that one stays.
                    */}
                    {/* Title and status on ONE line, address beneath — the
                        shape the smart-link rows use. The two lists sit in the
                        same card and were reading as two different products
                        because their identity blocks were built differently.

                        It fits now only because the "Landing Page" badge went:
                        the title truncates and the status never does. */}
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="truncate font-medium text-[var(--v2-text-primary)]" title={p.title}>
                        {p.title}
                      </p>
                      <span
                        className={`shrink-0 whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded ${
                          p.status === 'live'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        {p.status === 'live' ? labels.status_live : labels.status_draft}
                      </span>
                    </div>
                    {p.slug && (
                      <div className="flex items-center gap-2 mt-1 min-w-0" dir="ltr">
                        <span className="truncate text-xs text-[var(--v2-text-muted)] font-mono">
                          /{p.slug}
                        </span>
                      </div>
                    )}
                    {/* The same line the smart-link rows carry, for the same
                        reason: the icon's colour is not a label. */}
                    <p className="truncate text-[11px] text-[var(--v2-text-muted)] mt-0.5">
                      {labels.type_landing_page}
                    </p>
                  </div>
                </div>
              </div>

              {/* ACTIONS — at the end of the row, like the smart-link rows, so
                  every entry's controls sit in the same place whatever its name
                  or address happens to be. */}
              <div className="flex items-center gap-2 shrink-0 lg:ms-auto lg:order-last">
                {/* Sized and weighted like the smart-link row's actions below —
                    the two lists sit in one card and had two different button
                    scales, so a landing page's Edit read as the heavier thing. */}
                <button
                  onClick={() => handleSelectPage(p)}
                  className="px-2 py-1 text-xs font-medium text-[var(--v2-text-muted)] hover:text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded transition-colors"
                >
                  {labels.edit_page}
                </button>
                {/* Live or not — the landing page's version of a smart link's
                    activate and deactivate. */}
                {p.status === 'live' ? (
                  <button
                    onClick={() => handleUnpublishLanding(p)}
                    disabled={publishLandingBusy}
                    className="px-2 py-1 text-xs font-medium text-[var(--v2-text-muted)] hover:text-amber-600 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                  >
                    {labels.unpublish_landing}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setPublishLanding(p);
                      setPublishSlugDraft(p.slug || '');
                      setPublishSubdomainDraft(p.subdomain || subdomain || '');
                      setPublishLandingError(null);
                    }}
                    disabled={publishLandingBusy}
                    className="px-2 py-1 text-xs font-medium text-green-600 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 rounded transition-colors disabled:opacity-50"
                  >
                    {labels.publish_landing}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlePreview(p.id)}
                  disabled={previewChecking}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors disabled:opacity-50"
                  title={labels.preview}
                >
                  <Eye className="h-4 w-4" />
                </button>
                {/* Share, on a published landing page only.
                    A draft has no public address to tag, and offering to share
                    one would hand out a link that 404s. */}
                {p.status === 'live' && subdomain && (
                  <ShareMenu
                    /* `{subdomain}.agentpilot.io/{slug}` — the route that
                       actually serves it (app/site/[subdomain]/[slug]), not the
                       internal /website-preview/{id} the eye icon opens. */
                    target={{ kind: 'page', url: `https://${subdomain}.agentpilot.io/${p.slug}` }}
                    title={p.title}
                    language={language}
                    isRTL={language === 'he'}
                    compact
                  />
                )}
                <button
                  onClick={() => handleDeletePageClick(p.id, p.title)}
                  disabled={checkingActivity}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-50"
                  title={labels.delete_page}
                >
                  {checkingActivity ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* The same four tiles in the same card as the smart-link rows:
                  two different kinds of entry, read together, so they must
                  measure the same. */}
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--v2-border)] bg-[var(--v2-surface)] p-2 shrink-0">
                {([
                  { value: landingPagesAnalytics[p.id]?.visitors_today ?? 0, label: labels.visitors_today, muted: (landingPagesAnalytics[p.id]?.visitors_today ?? 0) === 0 },
                  { value: landingPagesAnalytics[p.id]?.visitors_30d ?? 0, label: labels.visitors_30d, muted: false },
                  { value: landingPagesAnalytics[p.id]?.unique_visitors ?? 0, label: labels.unique_visitors, muted: false },
                  { value: landingPagesAnalytics[p.id]?.total_views ?? 0, label: labels.total_views, muted: false },
                ] as const).map(stat => (
                  <div key={stat.label} className="w-[74px] shrink-0 rounded-lg bg-[var(--v2-bg)] px-1 py-1.5 text-center">
                    <p className={`text-[15px] font-semibold tabular-nums leading-tight ${stat.muted ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'}`}>
                      {stat.value}
                    </p>
                    <p className="truncate text-[10px] text-[var(--v2-text-muted)]" title={stat.label}>
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {allPages.filter(p => p.page_type === 'landing').length === 0 && smartLinks.length === 0 && (
            <div className="text-center py-8 bg-[var(--v2-surface)] rounded-lg">
              <Megaphone className="w-10 h-10 mx-auto text-[var(--v2-text-muted)] mb-3 opacity-50" />
              <p className="text-sm text-[var(--v2-text-secondary)] font-medium">
                {labels.no_landing_pages}
              </p>
              <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                {labels.no_landing_pages_desc}
              </p>
            </div>
          )}
        </div>

      </div>
    </>
  );


  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">

      {/* Main Content with max-width like CRM dashboard */}
      <div className={`${PAGE_CONTAINER} py-6 sm:py-8 space-y-8`}>

        {/*
          Anything the last action needs to say — a generation that fell back to
          placeholder copy, a landing page that could not be created, a smart
          link that refused to switch on.
          Rendered for EVERY view rather than only inside the wizard: it was
          gated on `viewMode === 'wizard'`, so a message raised after the wizard
          closed had nowhere to appear and the action looked as if it had simply
          done nothing.
        */}
        {generationNotice && (
          <div
            className={`px-4 py-3 text-sm border ${
              generationNotice.kind === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
                : generationNotice.kind === 'progress'
                  ? 'bg-[#4F6EF7]/10 border-[#4F6EF7]/30 text-[#4F6EF7]'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
            role="status"
          >
            {generationNotice.message}
          </div>
        )}

        {/* Page Header with blue theme (Website capability color) - matching CRM pattern */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div
              className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                page?.page_type === 'landing'
                  ? 'bg-purple-100 dark:bg-purple-900/30'
                  : ''
              }`}
              style={page?.page_type !== 'landing' ? { backgroundColor: 'rgba(79, 110, 247, 0.2)' } : undefined}
            >
              {page?.page_type === 'landing' ? (
                <Megaphone className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" />
              ) : (
                <Globe className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: WEBSITE_COLOR }} />
              )}
            </div>
            <div className="min-w-0">
              {/*
                The heading names what is open, not the screen.

                A landing page already did this; the website did not — so
                editing a site's sections left the header saying "Online
                presence", which is the name of the LIST this page came from.
                With a page open the only useful answer to "where am I?" is
                which page.

                `editingPage` is a page being worked on rather than merely
                loaded: the website's homepage is held in `page` from the moment
                the screen opens, so keying off `page` alone would rename the
                overview of the list to the name of one item in it.
              */}
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] truncate">
                {editingPage
                  ? (page!.page_type === 'landing'
                      ? (page!.title || labels.title)
                      /*
                       * "Acme: Website", not the page's own title.
                       *
                       * A homepage's `title` is its SEO title — "David KPMG
                       * Personal Training Studio: Transform Your Fitness" —
                       * written for a search result, not for a header. It
                       * clipped, and what survived the clip was whichever half
                       * came first rather than the name of the thing being
                       * edited. A landing page keeps its own title because that
                       * IS its name: short, chosen by the owner, and the only
                       * way to tell two landing pages apart.
                       */
                      : `${businessProfile?.company_name || labels.title}: ${
                          language === 'he' ? 'אתר' : language === 'es' ? 'Sitio Web' : 'Website'
                        }`)
                  : labels.title}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-0.5 sm:mt-1 hidden sm:block">
                {editingPage
                  ? (page!.page_type === 'landing'
                      ? (language === 'he' ? 'עריכת דף נחיתה' : language === 'es' ? 'Editando Página de Destino' : 'Editing Landing Page')
                      : (language === 'he' ? 'עריכת האתר' : language === 'es' ? 'Editando el Sitio' : 'Editing Website'))
                  : labels.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
            {/*
              No "main website" button here. The Overview tab in the row below
              releases the landing page and returns to the website, so this was
              a second control doing one job — and one that appeared in the page
              header only while a landing page happened to be open.
            */}

            {/* The tabs that are not the website's.
                They were all hidden without an AgentsPilot page, which took
                the theme with them — and the theme is not a website setting:
                the invoice PDF, every transactional email and any landing page
                or smart link are drawn from the same colours. A business
                reaching clients by link had no way to set its own look, and
                the readiness chain's design step pointed at a tab that did not
                exist.

                Templates works with no page at all — picking one is how a site
                gets created. Settings shows what it can: its fields belong to a
                published page, so without one it says so rather than offering a
                form that cannot save. */}
            {/* Shown in the wizard too.
                Hiding the row while the wizard is open left no way out of it
                short of finishing: someone who opened it to look, and thought
                better of a website, was stuck building one. */}
            {true && (
              <>
                {/* Global Tabs - Design, Settings only (applies to all page types) */}
                <div
                  className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-0.5 sm:p-1 inline-flex gap-0.5 sm:gap-1"
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  {[
                    { id: 'overview', icon: Globe, title: labels.tab_overview, needsPage: false },
                    { id: 'design', icon: Palette, title: labels.tab_design, needsPage: false },
                    // Moved up from the website section's own tab row. Choosing
                    // a template is a change to the whole site, like design and
                    // settings beside it — not one more thing inside the page
                    // being edited, which is where it used to sit.
                    { id: 'templates', icon: LayoutTemplate, title: labels.tab_templates, needsPage: true },
                    { id: 'settings', icon: Settings, title: labels.tab_settings, needsPage: true }
                  ].map((tab) => (
                    <motion.button
                      key={tab.id}
                      /*
                        A slow breath on Templates while no template is chosen.
                        Everything generated afterwards is built from it, so a
                        business that has not picked one should be drawn to it —
                        but this sits in a header the person reads past all day,
                        so it fades rather than flashes: two and a half seconds,
                        eased, and never below half opacity. Off entirely for
                        anyone who asked their system for less motion.
                      */
                      animate={
                        !currentTemplateId && tab.id === 'templates' && !prefersReducedMotion
                          ? { opacity: [1, 0.5, 1] }
                          : { opacity: 1 }
                      }
                      transition={
                        !currentTemplateId && tab.id === 'templates' && !prefersReducedMotion
                          ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }
                          : { duration: 0 }
                      }
                      /* Icon AND word.
                         These were four unlabelled glyphs with a `title`
                         tooltip — an eye, a palette, a page and a cog — which
                         asks the reader to guess, and a tooltip only answers
                         for someone who already suspected there was something
                         to hover. The label is what makes the row legible on
                         first sight; the icon stays because it is what makes it
                         findable on the tenth. Hidden below `sm`, where four
                         words will not fit and the header already collapses. */
                      className={`px-1.5 py-1.5 sm:px-2.5 sm:py-2 inline-flex items-center gap-1.5 transition-all border ${
                        viewMode === tab.id
                          ? 'text-[#4F6EF7] border-[#4F6EF7] bg-[#4F6EF7]/10'
                          : !currentTemplateId && tab.id === 'templates'
                            ? 'text-[#4F6EF7] border-[#4F6EF7]/40 bg-[#4F6EF7]/5'
                            : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      onClick={() => {
                        // These tabs are the website's. Leaving a landing page
                        // open behind them stranded the header on its title
                        // with no landing page in sight — the Overview tab in
                        // particular, which shows the website's card.
                        if (page?.page_type === 'landing') {
                          const homepage = allPages.find(p => p.page_type === 'homepage');
                          if (homepage) {
                            handleSelectPage(homepage);
                          } else {
                            setPage(null);
                            setBlocks([]);
                          }
                        }
                        setViewMode(tab.id as ViewMode);
                      }}
                      title={tab.title}
                    >
                      <tab.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                      <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">
                        {tab.title}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </>
            )}

            {/* Create Website — offered whenever there is no site yet.
                It used to be gated on `offerWebsite`, the answer given during
                onboarding, so a business that said "just a booking link" had no
                way to change its mind: no button, and the empty state below is
                hidden from it too. Declining a website at sign-up is a decision
                about that moment, not a permanent one. */}
            {!loading && !page && (
              <button
                onClick={() => setViewMode('wizard')}
                className="flex items-center gap-2 px-4 py-2 text-[#4F6EF7] text-sm font-medium border border-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-4 w-4" />
                {labels.create_website}
              </button>
            )}
          </div>
        </div>

        {/* Loading State - matching CRM pattern */}
        {loading && (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div
                className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: WEBSITE_COLOR, borderTopColor: 'transparent' }}
              />
              <p className="text-[var(--v2-text-secondary)] font-medium">{labels.loading}</p>
            </div>
          </div>
        )}

        {/* No website yet — the invitation to make one.
            Shown to everyone without a site, not only to those who asked for
            one at sign-up. A business reaching clients by link saw nothing here
            at all: no card, no template grid, and the header button hidden too,
            so "I'd like a website after all" had no route. Only on Overview,
            so it does not sit under the Design or Templates tabs which have
            their own content. */}
        {/*
          ───────────────────────────────────────────────────────────────────
          WHAT TO DO HERE, IN PLAIN WORDS.

          Dynamic, because the answer genuinely differs. A business that asked
          for a website is told to read and publish it; one that declined a
          website is told its booking link IS its front door and is currently
          off — and is never told to go and build the site it turned down.

          Only on Overview. The Design, Templates and Settings tabs are places
          somebody has already navigated to on purpose, and a standing
          instruction there is nagging rather than guidance.

          Not shown while loading: an empty page briefly looks like a business
          with nothing, and "you have no website" is a bad first thing to read
          about a site that is about to appear.
        */}
        {/*
          The attention frame, as a slow breath rather than a flash.

          A static ring is easy to miss on a page of cards that all have
          borders; a hard blink is an alarm, and nothing here is wrong. Two and
          a half seconds, eased, never fully off, so it reads as "this one"
          rather than "something has broken".

          `box-shadow` and not `border`, because the border is already carrying
          the card's own colour and animating it would make the frame flicker
          between two identities. The shadow sits outside it and changes
          nothing about the layout.

          Off entirely for anyone who asked their system for less motion, and
          the ring stays, so the mark survives without the movement.
        */}
        <style jsx global>{`
          @keyframes ap-attention {
            0%, 100% { box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.28); }
            50%      { box-shadow: 0 0 0 6px rgba(79, 110, 247, 0.10); }
          }
          .ap-attention { animation: ap-attention 2.5s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .ap-attention { animation: none; }
          }
        `}</style>

        {!loading && viewMode === 'overview' && (
          <div
            className={`p-4 border ${
              presenceGuidance.urgency === 'required'
                ? 'bg-[#4F6EF7]/5 border-[#4F6EF7]/30'
                : 'bg-[var(--v2-surface)] border-[var(--v2-border)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-card)' }}
            role="status"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-8 h-8 shrink-0 flex items-center justify-center ${
                  presenceGuidance.urgency === 'required'
                    ? 'bg-[#4F6EF7]/15 text-[#4F6EF7]'
                    : 'bg-green-500/15 text-green-600 dark:text-green-400'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {presenceGuidance.urgency === 'required'
                  ? <Target className="w-4 h-4" />
                  : <Check className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  {t('presence.guide.title')}
                </p>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-1 leading-relaxed">
                  {t(`presence.guide.${presenceGuidance.state}`)}
                </p>
                {/*
                  Said only where it changes what the owner should do: a
                  business with no site and no live booking link is reachable
                  for MESSAGES but not for bookings, and that distinction is
                  the difference between "nobody can find me" and "nobody can
                  book me".
                */}
                {presenceGuidance.state === 'activate_link' && (
                  <p className="text-xs text-[var(--v2-text-muted)] mt-2">
                    {t('presence.guide.contact_note')}
                  </p>
                )}
                {/*
                  The other way to be findable, where there is one.

                  The notice names the shortest route by number of steps, and a
                  drafted website is one step — but that step is reading a whole
                  site before putting it in front of clients. A dormant booking
                  link is a switch. A business with both was told about the long
                  route and never told the short one existed, so it read as an
                  instruction rather than a choice.
                */}
                {presenceGuidance.alsoActivateLink && (
                  <p className="text-sm text-[var(--v2-text-secondary)] mt-2 leading-relaxed">
                    {t('presence.guide.also_link')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && !page && viewMode === 'overview' && (
          <div
            className="text-center py-6 px-5 bg-[var(--v2-surface)] border border-[var(--v2-border)]"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {/* An invitation, not a hero. The 80px badge and 16-unit padding
                gave a card with one action the weight of a landing page — and
                on a link-only business it sat above the links that are their
                actual presence. */}
            <div
              className="w-9 h-9 mx-auto rounded-lg flex items-center justify-center mb-2.5"
              style={{ backgroundColor: 'rgba(79, 110, 247, 0.1)' }}
            >
              <Globe className="w-4 h-4" style={{ color: WEBSITE_COLOR }} />
            </div>
            <h2 className="text-[15px] font-bold text-[var(--v2-text-primary)] mb-1">
              {labels.no_website}
            </h2>
            <p className="text-[13px] text-[var(--v2-text-secondary)] max-w-sm mx-auto leading-snug">
              {labels.no_website_desc}
            </p>

            {/* No action inside the card.
                It first held a grid of four template thumbnails, then a button
                that repeated the "Create Website" already sitting in the header
                above it. One action, in one place; this card only says what is
                missing. */}
          </div>
        )}

        {/* Website Management Content.
            The wrapper used to require a page, so a business without one saw
            four tabs that did nothing when clicked. Design and Templates need
            no page at all — the theme is the whole platform's look, and
            picking a template is how a site gets created — so each tab now
            states its own requirement. */}
        {!loading && (
          <>
            {/* Overview Tab */}
            {viewMode === 'overview' && page && (
              <div className="space-y-6">
                {/* Main Website Overview - shown when NOT editing a landing page */}
                {page.page_type !== 'landing' && (
                  <>
                {/* Row 1: Analytics + Main Website Card */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Stats Card */}
                  <div
                    className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <h3 className="text-sm font-medium text-[var(--v2-text-muted)] uppercase tracking-wider mb-4">
                      {labels.page_views}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Today */}
                      <div className="text-center p-3 bg-[var(--v2-bg)] rounded-lg">
                        <p className="text-2xl font-bold text-[var(--v2-text-primary)]">{analytics?.visitors_today ?? 0}</p>
                        <p className="text-xs text-[var(--v2-text-muted)]">{labels.visitors_today}</p>
                      </div>
                      {/* 7 Days */}
                      <div className="text-center p-3 bg-[var(--v2-bg)] rounded-lg">
                        <p className="text-2xl font-bold text-[var(--v2-text-primary)]">{analytics?.visitors_7d ?? 0}</p>
                        <p className="text-xs text-[var(--v2-text-muted)]">{labels.visitors_7d}</p>
                      </div>
                      {/* 30 Days */}
                      <div className="text-center p-3 bg-[var(--v2-bg)] rounded-lg">
                        <p className="text-2xl font-bold text-[var(--v2-text-primary)]">{analytics?.visitors_30d ?? 0}</p>
                        <p className="text-xs text-[var(--v2-text-muted)]">{labels.visitors_30d}</p>
                      </div>
                      {/* Total Views */}
                      <div className="text-center p-3 bg-[var(--v2-bg)] rounded-lg">
                        <p className="text-2xl font-bold text-[var(--v2-text-primary)]">{analytics?.total_views ?? 0}</p>
                        <p className="text-xs text-[var(--v2-text-muted)]">{labels.total_views}</p>
                      </div>
                    </div>
                    {/* Unique visitors summary */}
                    <div className="mt-4 pt-4 border-t border-[var(--v2-border)]">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--v2-text-muted)]">{labels.unique_visitors}</span>
                        <span className="text-lg font-semibold text-[var(--v2-text-primary)]">{analytics?.unique_visitors ?? 0}</span>
                      </div>
                    </div>
                  </div>

                  {/* Main Website Card */}
                  <div
                    /* Marked while the notice is asking for this card and no
                       longer, for the same reason as the link row below. */
                    className={`lg:col-span-2 bg-[var(--v2-surface)] border p-6 transition-shadow ${
                      presenceGuidance.state === 'publish_website'
                        ? `border-[#4F6EF7] ring-2 ring-[#4F6EF7]/30${prefersReducedMotion ? '' : ' ap-attention'}`
                        : 'border-[#4F6EF7]/30'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    {/* The badge drops under the title on a phone rather than
                        competing with it for the same line — "Manage your
                        professional website" and a status pill cannot both fit
                        across 375px without one of them wrapping to two
                        characters a line. */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#4F6EF7]/10 shrink-0">
                          <Globe className="w-5 h-5 text-[#4F6EF7]" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                            {labels.main_website}
                          </h3>
                          <p className="text-sm text-[var(--v2-text-muted)]">
                            {labels.main_website_desc}
                          </p>
                        </div>
                      </div>
                      {/* Status Badge */}
                      <span
                        className={`self-start shrink-0 px-3 py-1 text-xs font-medium rounded-full ${
                          page.status === 'live'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        {page.status === 'live' ? labels.status_live : labels.status_draft}
                      </span>
                    </div>

                    {/* URL Display */}
                    {page.subdomain && (
                      <div className="flex items-center gap-3 p-3 bg-[var(--v2-bg)] rounded-lg mb-4">
                        <Globe className="w-5 h-5 text-[var(--v2-text-muted)] shrink-0" />
                        {/* `break-all`, because an address is one unbreakable
                            token: with nothing to wrap on it pushed the copy
                            button off the card instead of wrapping. */}
                        <span className="flex-1 min-w-0 break-all text-[var(--v2-text-secondary)] text-sm font-mono">
                          {page.subdomain}.agentpilot.io
                        </span>
                        {/*
                          Only once the site is LIVE.
                          ───────────────────────────────────────────────────
                          The address exists as soon as a subdomain is claimed,
                          but a drafted site does not answer at it. Offering to
                          share one hands the owner a link to give a client
                          that goes nowhere — and they would not find out until
                          the client told them.

                          The address itself still shows, because knowing what
                          it WILL be is useful while the site is being built.
                          Sharing it is not.
                        */}
                        {page.status === 'live' && (
                        <ShareMenu
                          target={{ kind: 'page', url: `https://${page.subdomain}.agentpilot.io` }}
                          title={page.title || `${page.subdomain}.agentpilot.io`}
                          language={language}
                          isRTL={language === 'he'}
                          compact
                        />
                        )}
                      </div>
                    )}

                    {/* Website Actions */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Website-specific tabs - content editing for this specific page */}
                      <div
                        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-0.5 inline-flex gap-0.5"
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                      >
                        {[
                          /*
                            The Client Journey tab is gone.
                            Its three jobs moved to where each belongs: the
                            "How It Works" section is now a section like any
                            other, "show services without booking flow" sits in
                            the services section it governs, and each service's
                            journey is drawn on that service's own row. Nothing
                            navigated here but this button.
                          */
                          { id: 'sections', icon: Layout, title: labels.tab_sections }
                          // Templates moved to the global tab row above.
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            /* Icon AND word, like the tabs in the page header.
                               A lone glyph asks the reader to guess, and the
                               tooltip only answers for someone who already
                               suspected there was something to hover — which is
                               doubly true now that this is the only button left
                               in the row and has no siblings to give it
                               context. */
                            className={`px-2.5 py-1.5 inline-flex items-center gap-1.5 transition-all border ${
                              viewMode === tab.id
                                ? 'text-[#4F6EF7] border-[#4F6EF7] bg-[#4F6EF7]/10'
                                : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                            }`}
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                            onClick={() => setViewMode(tab.id as ViewMode)}
                            title={tab.title}
                          >
                            <tab.icon className="h-4 w-4 shrink-0" />
                            <span className="text-sm font-medium whitespace-nowrap">{tab.title}</span>
                          </button>
                        ))}
                      </div>

                      {/* View Site Button - only when live */}
                      {page.status === 'live' && page.subdomain && (
                        <a
                          href={getWebsiteUrl() || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <ExternalLink className="h-4 w-4" />
                          {labels.view_site}
                        </a>
                      )}

                      {/* Preview Button - only when NOT live (draft) */}
                      {page.status !== 'live' && (
                        <button
                          onClick={() => handlePreview()}
                          disabled={previewChecking}
                          className="flex items-center gap-2 px-3 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          {previewChecking ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          {labels.preview}
                        </button>
                      )}

                      {/* Publish/Unpublish Button */}
                      {page.status === 'live' ? (
                        <button
                          onClick={handleUnpublish}
                          disabled={publishing}
                          className="flex items-center gap-2 px-4 py-2 text-amber-600 text-sm font-medium border border-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-700 dark:hover:bg-amber-900/30 transition-all disabled:opacity-50"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : labels.unpublish}
                        </button>
                      ) : (
                        <button
                          onClick={handlePublish}
                          disabled={publishing || !page.subdomain}
                          className="flex items-center gap-2 px-4 py-2 text-[#4F6EF7] text-sm font-medium border border-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all disabled:opacity-50"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          {publishing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {labels.publishing}
                            </>
                          ) : (
                            <>
                              <Rocket className="h-4 w-4" />
                              {labels.publish}
                            </>
                          )}
                        </button>
                      )}

                      {/*
                        Delete, on the card that is the website.

                        Pushed to the far end and given no fill, so it reads as
                        the last resort in a row whose other buttons are things
                        you do routinely. It was at the foot of the Settings tab
                        — the convention the account page uses for its danger
                        zone — but the website is a thing on a card here, and
                        the actions that act on it belong with it.
                      */}
                      <button
                        onClick={() => setDeleteWebsiteOpen(true)}
                        disabled={publishing || deletingWebsite}
                        className="flex items-center gap-2 px-3 py-2 ms-auto text-sm font-medium text-[var(--v2-text-muted)] hover:text-red-600 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={labels.delete_website_body}
                      >
                        <Trash2 className="h-4 w-4" />
                        {labels.delete_website_action}
                      </button>
                    </div>

                    {/*
                      Why the last publish was refused, on the card that carries
                      the button.

                      The route already names the services holding it up — "X
                      asks clients to pick a time, but you have no working hours
                      set" — and the handler used to discard it, so the button
                      stopped spinning and said nothing.

                      The control beneath it is the Configuration dialog this
                      page already opens elsewhere, pointed at its availability
                      tab: the one gap that blocks a publish is working hours,
                      so the message and the place to fix it sit together.
                    */}
                    {/*
                      What is stopping the publish, and where to fix it.

                      One CARD per problem rather than a paragraph of them.
                      Each states the issue in a sentence, and carries the
                      control that fixes it — availability or invoice details,
                      which live on different tabs.

                      The earlier version joined every gap into one block of red
                      text under a single link, so a page held up by two things
                      named both and offered a route to one. It also opened with
                      the list of affected services, which pushed the actual
                      problem to the end of a long sentence.

                      `publishGaps` is empty when the refusal was something else
                      — no address, no sections — and then the plain message is
                      shown on its own, because there is no per-gap action to
                      offer.
                    */}
                    {publishError && (
                      <div className="mt-4 space-y-2">
                        {publishGaps.length > 0 ? (
                          publishGaps.map(gap => {
                            const isInvoicing = gap.kind === 'invoicing';
                            const GapIcon = isInvoicing ? FileText : Clock;
                            return (
                              <div
                                key={gap.kind}
                                className="flex items-start gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                                style={{ borderRadius: 'var(--v2-radius-card)' }}
                              >
                                <div
                                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                >
                                  <GapIcon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-[var(--v2-text-primary)]">
                                    {gap.message}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openConfiguration(isInvoicing ? 'invoice' : 'availability', {
                                        // The owner has just been sent to fix the very
                                        // thing this names; ask again rather than leave
                                        // the refusal asserting the old answer.
                                        onClose: recheckPublishReadiness,
                                      })
                                    }
                                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {isInvoicing
                                      ? labels.publish_fix_invoicing
                                      : labels.publish_fix_availability}
                                    <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p
                            className="p-3 text-sm bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
                            style={{ borderRadius: 'var(--v2-radius-card)' }}
                            role="status"
                          >
                            {publishError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {renderLeadGeneration()}
                  </>
                )}
              </div>
            )}

            {viewMode === 'sections' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {page?.page_type === 'landing'
                        ? (language === 'he' ? 'עריכת דף נחיתה' : language === 'es' ? 'Editar Página de Destino' : 'Edit Landing Page')
                        : labels.sections_title}
                    </h3>
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                      {page?.page_type === 'landing'
                        ? (language === 'he' ? 'ערוך את התוכן והעיצוב של דף הנחיתה שלך' : language === 'es' ? 'Edita el contenido y diseño de tu página' : 'Edit the content and design of your landing page')
                        : labels.sections_desc}
                    </p>
                  </div>

                  {/* Action Buttons - Different for landing pages vs main website */}
                  <div className="flex items-center gap-3">
                    {/* Preview Button for Landing Pages - "View Landing Page" */}
                    {page?.page_type === 'landing' && (
                      <button
                        type="button"
                        onClick={() => handlePreview(page.id)}
                        disabled={previewChecking}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4F6EF7] hover:bg-[#3D5BD9] transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <Eye className="w-4 h-4" />
                        {language === 'he' ? 'צפה בדף הנחיתה' : language === 'es' ? 'Ver Página' : 'View Landing Page'}
                      </button>
                    )}
                    {/* The way back is the Overview tab in the header row. */}
                    {/* Main Website specific buttons */}
                    {page?.page_type !== 'landing' && syncResult && (
                      <span className={`text-sm ${syncResult.count > 0 ? 'text-green-500' : 'text-[var(--v2-text-muted)]'}`}>
                        {syncResult.message}
                      </span>
                    )}
                    {/* Reset Order Button - Main website only */}
                    {page?.page_type !== 'landing' && (
                      <button
                        onClick={handleResetBlockOrder}
                        disabled={resettingOrder}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface-elevated)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                        title={language === 'he' ? 'איפוס סדר לברירת מחדל' : language === 'es' ? 'Restablecer orden' : 'Reset to default order'}
                      >
                        {resettingOrder ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                        {language === 'he' ? 'איפוס סדר' : language === 'es' ? 'Restablecer' : 'Reset Order'}
                      </button>
                    )}
                    {/* Add Section Button - Main website only */}
                    {page?.page_type !== 'landing' && (
                      <button
                        onClick={() => setShowAddSectionModal(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <Plus className="w-4 h-4" />
                        {language === 'he' ? 'הוסף חלק' : language === 'es' ? 'Agregar Sección' : 'Add Section'}
                      </button>
                    )}
                    {/* Sync Button - Main website only */}
                    {page?.page_type !== 'landing' && (
                      <button
                        onClick={handleSyncWithBusinessData}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4F6EF7] hover:bg-[#3D5BD9] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {syncing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {labels.syncing}
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            {labels.sync_business_data}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/*
                  Removed: the landing page's client journey editor.

                  It offered a per-page journey — drag to reorder, add or remove
                  steps, then "save client journey" — but a journey is not a
                  property of a page. It belongs to the service: whether the
                  client picks a time (`is_scheduled`) and how the money arrives
                  (`collection`), which is why one landing page selling two
                  services has two journeys and no single strip can describe it.
                  The same editor was already removed from the website's
                  sections view and from the landing page wizard's step 3; this
                  was the last copy, and it survived only because the bug that
                  cleared `page` also stopped it rendering.
                */}

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleBlockDragEnd}
                >
                  <SortableContext
                    items={blocks
                      .sort((a, b) => a.position - b.position)
                      .map(b => b.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3 pl-8">
                      {/*
                        Every block, including `process`.

                        "How It Works" was hidden from this list and edited in a
                        tab of its own, which gave it a different shape from
                        every other section — no enable switch, no drag handle,
                        no place in the order — while still rendering publicly
                        between Services and Testimonials.
                      */}
                      {blocks
                        .sort((a, b) => a.position - b.position)
                        .map((block) => {
                          const isExpanded = expandedBlockId === block.id;
                          const BlockIcon = getBlockIcon(block.block_type);
                          return (
                            <SortableBlockItem key={block.id} id={block.id}>
                              <div
                                // `!== false`, matching the switch below. Read as
                                // plain truthiness, a block whose `enabled` came
                                // back null drew the dimmed, switched-off row
                                // while its switch showed ON — so the first click
                                // turned it off and nothing on screen changed.
                                className={`rounded-lg border transition-all ${
                                  block.enabled !== false
                                    ? 'bg-[var(--v2-bg)] border-[var(--v2-border)]'
                                    : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-60'
                                }`}
                              >
                          {/* Block Header */}
                          <div className="flex items-center justify-between p-4">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#4F6EF7]/10">
                                <BlockIcon className="w-5 h-5 text-[#4F6EF7]" />
                              </div>
                              <div>
                                <p className="font-medium text-[var(--v2-text-primary)]">
                                  {getBlockName(block.block_type)}
                                </p>
                                <p className="text-xs text-[var(--v2-text-muted)]">
                                  {labels.position} {block.position + 1}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              {/* Edit Button */}
                              <button
                                onClick={() => handleExpandBlock(block.id, block.content as Record<string, unknown>, block.block_type)}
                                className={`p-2 rounded-lg transition-colors ${
                                  isExpanded
                                    ? 'bg-[#4F6EF7]/10 text-[#4F6EF7]'
                                    : 'text-[var(--v2-text-muted)] hover:text-[#4F6EF7] hover:bg-[var(--v2-surface)]'
                                }`}
                                title={labels.edit_block}
                              >
                                {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                              </button>

                              {/* Toggle */}
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={block.enabled !== false}
                                  onChange={(e) => handleToggleBlock(block.id, e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
                              </label>

                              {/* Delete Button - Only show for non-required blocks */}
                              {!REQUIRED_BLOCKS.includes(block.block_type) && (
                                <button
                                  onClick={() => handleDeleteBlockClick(block.id, block.block_type)}
                                  className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                  title={language === 'he' ? 'מחק מקטע' : language === 'es' ? 'Eliminar sección' : 'Delete section'}
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expanded Content Editor */}
                          {isExpanded && editingBlockContent && (
                            <div className="px-4 pb-4 pt-2 border-t border-[var(--v2-border)]">
                              <div className="space-y-4">
                                {/*
                                  * Website AI writing is switched off (Layer 2 FR-14).
                                  *
                                  * One notice at the top of the block being edited rather
                                  * than one per button: every "write this for me" control in
                                  * this panel — the field buttons and the testimonial
                                  * enhancer — is off for the same reason, at the same moment,
                                  * and eleven copies of one sentence would be noise. Scoped
                                  * to the block so it appears where the owner just pressed.
                                  *
                                  * Amber, not red: nothing failed and nothing was
                                  * overwritten — their text is exactly as they left it.
                                  */}
                                {aiWritingUnavailable === block.id && (
                                  <div
                                    role="status"
                                    className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
                                  >
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{labels.ai_unavailable}</span>
                                  </div>
                                )}
                                {/* Hero Block Fields */}
                                {block.block_type === 'hero' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.headline}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'headline', 'Generate a compelling headline')}
                                          disabled={generatingAI === `${block.id}-headline`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-headline` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.headline as string) || ''}
                                        onChange={(e) => updateBlockField('headline', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.subheadline}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subheadline', 'Generate a compelling subheadline')}
                                          disabled={generatingAI === `${block.id}-subheadline`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subheadline` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subheadline as string) || ''}
                                        onChange={(e) => updateBlockField('subheadline', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    {/* Hero Image */}
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {labels.hero_image}
                                      </label>
                                      <MediaUploader
                                        section="hero"
                                        aspect="portrait"
                                        /*
                                         * `background_image`, not `image`.
                                         *
                                         * The editor wrote `content.image` and
                                         * every hero renderer — the block and
                                         * the template shape alike — reads
                                         * `content.background_image`. So a
                                         * picture chosen here saved correctly,
                                         * came back in the field on reopen, and
                                         * never once appeared on the page: it
                                         * was written to a key nothing reads.
                                         *
                                         * `image` is still read first so any
                                         * hero that already has one keeps it.
                                         */
                                        value={
                                          (editingBlockContent.background_image as string)
                                          || (editingBlockContent.image as string)
                                          || ''
                                        }
                                        onChange={(url) => updateBlockField('background_image', url)}
                                        onRemove={() => updateBlockField('background_image', '')}
                                        placeholder={language === 'he' ? 'גרור תמונה או לחץ להעלאה' : language === 'es' ? 'Arrastra imagen o haz clic' : 'Drag image or click to upload'}
                                        previewClassName="w-full h-40"
                                      />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_text}
                                        </label>
                                        <input
                                          type="text"
                                          value={(editingBlockContent.cta_text as string) || ''}
                                          onChange={(e) => updateBlockField('cta_text', e.target.value)}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_link}
                                        </label>
                                        <input
                                          type="text"
                                          value={(editingBlockContent.cta_link as string) || ''}
                                          onChange={(e) => updateBlockField('cta_link', e.target.value)}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Header Block Fields */}
                                {block.block_type === 'header' && (
                                  <>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'טקסט לוגו' : language === 'es' ? 'Texto del logo' : 'Logo Text'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.logo_text as string) || ''}
                                        onChange={(e) => updateBlockField('logo_text', e.target.value)}
                                        placeholder={language === 'he' ? 'שם העסק שלך' : language === 'es' ? 'Nombre de tu negocio' : 'Your business name'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    {/* The logo is the business's, uploaded once in
                                        Settings. This page only chooses whether the
                                        header wears it. */}
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {language === 'he' ? 'לוגו' : language === 'es' ? 'Logo' : 'Logo'}
                                      </label>
                                      {businessProfile?.logo_url ? (
                                        <label className="flex items-center gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={editingBlockContent.show_logo === true}
                                            onChange={(e) => updateBlockField('show_logo', e.target.checked)}
                                            className="w-4 h-4 accent-[#4F6EF7]"
                                          />
                                          <img src={businessProfile.logo_url as string} alt="" className="h-8 w-auto object-contain" />
                                          <span className="text-sm text-[var(--v2-text-secondary)]">
                                            {language === 'he' ? 'הצג את הלוגו של העסק' : language === 'es' ? 'Mostrar el logo del negocio' : 'Show the business logo'}
                                          </span>
                                        </label>
                                      ) : (
                                        <p className="text-xs text-[var(--v2-text-muted)]">
                                          {language === 'he'
                                            ? 'עדיין לא הועלה לוגו. אפשר להעלות אותו בהגדרות ← העסק שלי.'
                                            : language === 'es'
                                              ? 'Aún no has subido un logo. Puedes subirlo en Ajustes → Negocio.'
                                              : 'No logo uploaded yet. Add one in Settings → Business.'}
                                        </p>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_text}
                                        </label>
                                        <input
                                          type="text"
                                          value={((editingBlockContent.cta_button as { text?: string; link?: string })?.text as string) || ''}
                                          onChange={(e) => updateBlockField('cta_button', {
                                            ...(editingBlockContent.cta_button as { text?: string; link?: string } || {}),
                                            text: e.target.value
                                          })}
                                          placeholder={language === 'he' ? 'קבע פגישה' : language === 'es' ? 'Reservar cita' : 'Book a session'}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_link}
                                        </label>
                                        <input
                                          type="text"
                                          value={((editingBlockContent.cta_button as { text?: string; link?: string })?.link as string) || ''}
                                          onChange={(e) => updateBlockField('cta_button', {
                                            ...(editingBlockContent.cta_button as { text?: string; link?: string } || {}),
                                            link: e.target.value
                                          })}
                                          placeholder="#booking"
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                    </div>
                                    {/* Menu Items */}
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {language === 'he' ? 'פריטי תפריט' : language === 'es' ? 'Elementos del menú' : 'Menu Items'}
                                      </label>
                                      <p className="text-xs text-[var(--v2-text-muted)] mb-3">
                                        {language === 'he'
                                          ? 'פריטי התפריט נוצרים אוטומטית מהסקשנים באתר'
                                          : language === 'es'
                                          ? 'Los elementos del menú se generan automáticamente a partir de las secciones del sitio'
                                          : 'Menu items are auto-generated from your website sections'}
                                      </p>
                                      <div className="space-y-2">
                                        {((editingBlockContent.menu_items as Array<{ label: string; anchor: string }>) || []).map((item, idx) => (
                                          <div key={idx} className="flex items-center gap-2 p-2 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                                            <input
                                              type="text"
                                              value={item.label}
                                              onChange={(e) => {
                                                const items = [...(editingBlockContent.menu_items as Array<{ label: string; anchor: string }>)];
                                                items[idx] = { ...items[idx], label: e.target.value };
                                                updateBlockField('menu_items', items);
                                              }}
                                              className="flex-1 px-2 py-1 bg-transparent border-0 text-sm text-[var(--v2-text-primary)] focus:outline-none"
                                              placeholder={language === 'he' ? 'תווית' : language === 'es' ? 'Etiqueta' : 'Label'}
                                            />
                                            <span className="text-xs text-[var(--v2-text-muted)]">{item.anchor}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* CTA Block Fields */}
                                {block.block_type === 'cta' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling CTA title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a persuasive CTA subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_text}
                                        </label>
                                        <input
                                          type="text"
                                          value={(editingBlockContent.cta_text as string) || ''}
                                          onChange={(e) => updateBlockField('cta_text', e.target.value)}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {labels.cta_link}
                                        </label>
                                        <input
                                          type="text"
                                          value={(editingBlockContent.cta_link as string) || ''}
                                          onChange={(e) => updateBlockField('cta_link', e.target.value)}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* About Block Fields */}
                                {block.block_type === 'about' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate an engaging about section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.about_text}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'about_text', 'Generate a compelling about section description')}
                                          disabled={generatingAI === `${block.id}-about_text`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-about_text` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={4}
                                        value={(editingBlockContent.about_text as string) || ''}
                                        onChange={(e) => updateBlockField('about_text', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {labels.section_image}
                                      </label>
                                      <MediaUploader
                                        section="about"
                                        aspect="portrait"
                                        value={(editingBlockContent.image as string) || ''}
                                        onChange={(url) => updateBlockField('image', url)}
                                        onRemove={() => updateBlockField('image', '')}
                                        placeholder={language === 'he' ? 'גרור תמונה או לחץ להעלאה' : language === 'es' ? 'Arrastra imagen o haz clic' : 'Drag image or click to upload'}
                                        previewClassName="w-full h-40"
                                      />
                                    </div>
                                  </>
                                )}

                                {/* Services Block - Special handling (linked to Scheduling) */}
                                {block.block_type === 'services' && (
                                  <>
                                    {/*
                                      ─────────────────────────────────────────
                                      "SHOW SERVICES WITHOUT BOOKING FLOW"

                                      It lived on the Client Journey tab, which
                                      is the wrong place to look for it: it is a
                                      decision about how THIS list behaves, and
                                      an owner asking "why is there no book
                                      button?" opens the services section.

                                      Still STORED on the process block, because
                                      `/api/website/booking/intake` reads it
                                      there with an explicit
                                      `.eq('block_type','process')` and the
                                      booking widget depends on the answer.
                                      Moving the storage would mean changing
                                      that route and migrating every existing
                                      row for no gain — the control moves, the
                                      field stays.
                                    */}
                                    <label className="flex items-center justify-between gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg cursor-pointer">
                                      <span>
                                        <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                                          {labels.journey_services_only}
                                        </span>
                                        <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                                          {labels.journey_services_only_desc}
                                        </span>
                                      </span>
                                      {/*
                                        The website capability's blue, as an
                                        INLINE style.

                                        A className override does not work here:
                                        `cn` in `lib/utils.ts` is a plain
                                        `.join(' ')`, not tailwind-merge — so a
                                        passed `data-[state=checked]:bg-…` does
                                        not replace the component's own
                                        `bg-[var(--v2-primary)]`, it sits beside
                                        it at equal specificity and loses or
                                        wins on whatever order Tailwind happened
                                        to emit them in. Inline beats both.

                                        Worth knowing beyond this switch: every
                                        `className` passed to a `components/ui`
                                        component to change a colour it already
                                        sets is a coin toss for the same reason.
                                      */}
                                      <Switch
                                        style={servicesOnly ? { backgroundColor: WEBSITE_COLOR } : undefined}
                                        checked={servicesOnly}
                                        onCheckedChange={(checked) => {
                                          setServicesOnly(checked);
                                          void persistServicesOnly(checked);
                                        }}
                                      />
                                    </label>

                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a services section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a services section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    {/* Services list with improved design */}
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Package className="w-4 h-4 text-[#4F6EF7]" />
                                          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                                            {language === 'he' ? 'שירותים' : language === 'es' ? 'Servicios' : 'Services'}
                                          </span>
                                          <span className="text-xs px-2 py-0.5 bg-[#4F6EF7]/10 text-[#4F6EF7] rounded-full">
                                            {(editingBlockContent.services as Array<{ hidden?: boolean }>)?.filter(s => !s.hidden).length || 0}
                                            {(editingBlockContent.services as Array<{ hidden?: boolean }>)?.some(s => s.hidden) && (
                                              <span className="text-[var(--v2-text-muted)]">
                                                /{(editingBlockContent.services as Array<unknown>)?.length || 0}
                                              </span>
                                            )}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <button
                                            onClick={handleRefreshServices}
                                            disabled={refreshingServices}
                                            className="flex items-center gap-1 text-xs text-[var(--v2-text-secondary)] hover:text-[#4F6EF7] disabled:opacity-50"
                                          >
                                            {refreshingServices ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <RefreshCw className="w-3 h-3" />
                                            )}
                                            {labels.refresh_services}
                                          </button>
                                          <button
                                            onClick={() => setIsConfigOpen(true)}
                                            className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9]"
                                          >
                                            <Link2 className="w-3 h-3" />
                                            {labels.edit_services}
                                          </button>
                                        </div>
                                      </div>

                                      {(editingBlockContent.services as Array<{ name: string; description?: string; price?: string; duration?: string; icon?: string; hidden?: boolean }>)?.length > 0 ? (
                                        <div className="grid gap-3">
                                          {(editingBlockContent.services as Array<{ name: string; description?: string; price?: string; duration?: string; icon?: string; hidden?: boolean }>).map((service, idx) => (
                                            <div
                                              key={idx}
                                              className={`p-4 bg-gradient-to-r from-[var(--v2-surface)] to-transparent border rounded-xl transition-colors ${
                                                service.hidden
                                                  ? 'border-[var(--v2-border)] opacity-50'
                                                  : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/30'
                                              }`}
                                            >
                                              <div className="flex items-start gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${service.hidden ? 'bg-gray-200 dark:bg-gray-700' : 'bg-[#4F6EF7]/10'}`}>
                                                  <ServiceIconRenderer icon={service.icon} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <h4 className={`font-medium truncate ${service.hidden ? 'text-[var(--v2-text-secondary)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                                                    {service.name}
                                                  </h4>
                                                  {service.description && !service.hidden && (
                                                    <p className="text-xs text-[var(--v2-text-secondary)] mt-1 line-clamp-2">
                                                      {service.description}
                                                    </p>
                                                  )}
                                                  {service.duration && !service.hidden && (
                                                    <div className="flex items-center gap-1 mt-2">
                                                      <Calendar className="w-3 h-3 text-[var(--v2-text-secondary)]" />
                                                      <span className="text-xs text-[var(--v2-text-secondary)]">{service.duration}</span>
                                                    </div>
                                                  )}
                                                  {service.hidden && (
                                                    <p className="text-xs text-[var(--v2-text-muted)] mt-1 italic">
                                                      {language === 'he' ? 'שירות מוסתר - לא יוצג באתר' : language === 'es' ? 'Servicio oculto - no se mostrará' : 'Hidden - won\'t be displayed on website'}
                                                    </p>
                                                  )}
                                                </div>

                                                {/*
                                                  What this service puts a client
                                                  through — its own column, in the
                                                  middle of the row.

                                                  It was stacked under the
                                                  description, which pushed every
                                                  row taller while the right half
                                                  of the card sat empty. A journey
                                                  is a horizontal thing: given a
                                                  column of its own it reads
                                                  across at a glance and costs no
                                                  height at all.

                                                  Dropped below `lg`, where the
                                                  chips would wrap into something
                                                  worse than absent. Same resolver
                                                  the public site uses, so it
                                                  cannot drift from the journey a
                                                  visitor actually walks.
                                                */}
                                                {/*
                                                  Price and visibility, in a
                                                  column of their own at the
                                                  row's end.

                                                  They used to sit inside the
                                                  title line, pushed right by a
                                                  `justify-between` — so their
                                                  x position depended on how long
                                                  the service NAME was, and the
                                                  journey chips beside them
                                                  started somewhere different on
                                                  every row. Three columns of
                                                  fixed order line up instead:
                                                  what it is, what it does, what
                                                  it costs.
                                                */}
                                                <div className="order-last flex items-center gap-2 shrink-0 self-center">
                                                      {service.price && !service.hidden && (
                                                        <span className="text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                                          {service.price}
                                                        </span>
                                                      )}
                                                      {/* Show/Hide Toggle Button */}
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          const services = [...(editingBlockContent.services as Array<{ name: string; description?: string; price?: string; duration?: string; icon?: string; hidden?: boolean }>)];
                                                          services[idx] = { ...services[idx], hidden: !services[idx].hidden };
                                                          updateBlockField('services', services);
                                                        }}
                                                        /*
                                                          This screen's colour.

                                                          Tried the SITE's brand
                                                          first, which sounds
                                                          right and is not: this
                                                          business is on Bold,
                                                          whose primary is flame
                                                          `#FC5F2B`, so every
                                                          switch in the editor
                                                          turned orange. A
                                                          control that acts on
                                                          the editor belongs to
                                                          the editor — the site's
                                                          palette is for things
                                                          that PREVIEW the site,
                                                          not for its chrome.
                                                        */
                                                        className={`p-1.5 rounded-lg transition-all ${
                                                          service.hidden
                                                            ? 'bg-[var(--v2-surface-2)] hover:bg-[var(--v2-surface-hover)]'
                                                            : 'hover:brightness-95'
                                                        }`}
                                                        style={
                                                          service.hidden
                                                            ? undefined
                                                            : {
                                                                backgroundColor: `color-mix(in srgb, ${WEBSITE_COLOR} 12%, transparent)`,
                                                                color: WEBSITE_COLOR,
                                                              }
                                                        }
                                                        title={service.hidden
                                                          ? (language === 'he' ? 'הצג באתר' : language === 'es' ? 'Mostrar en web' : 'Show on website')
                                                          : (language === 'he' ? 'הסתר מהאתר' : language === 'es' ? 'Ocultar de web' : 'Hide from website')
                                                        }
                                                      >
                                                        {service.hidden ? (
                                                          <EyeOff className="w-4 h-4 text-[var(--v2-text-muted)]" />
                                                        ) : (
                                                          <Eye className="w-4 h-4" />
                                                        )}
                                                      </button>
                                                </div>

                                                {!service.hidden && !servicesOnly && (
                                                  <div className="hidden lg:flex shrink-0 items-center self-center">
                                                    <ClientJourneyStrip
                                                      compact
                                                      intakeEnabled={intakeEnabled}
                                                      processorReady={processorReady}
                                                      service={{
                                                        scheduled: (service as { is_scheduled?: boolean }).is_scheduled !== false,
                                                        collection: (service as { collection?: string | null }).collection ?? null,
                                                        price: (service as { priceRaw?: number | null }).priceRaw ?? null,
                                                      }}
                                                    />
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="p-6 bg-[var(--v2-surface)] border border-dashed border-[var(--v2-border)] rounded-xl text-center">
                                          <Package className="w-8 h-8 text-[var(--v2-text-secondary)] mx-auto mb-2 opacity-50" />
                                          <p className="text-sm text-[var(--v2-text-secondary)]">
                                            {labels.no_services_hint}
                                          </p>
                                          <button
                                            onClick={() => setIsConfigOpen(true)}
                                            className="inline-flex items-center gap-1 text-sm text-[#4F6EF7] hover:text-[#3D5BD9] mt-2"
                                          >
                                            <Plus className="w-4 h-4" />
                                            {language === 'he' ? 'הוסף שירותים' : language === 'es' ? 'Agregar servicios' : 'Add services'}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}

                                {/* Process Block - Booking Flow + Custom Steps */}
                                {block.block_type === 'process' && (() => {
                                  /*
                                   * Everything the flow builder needed is gone
                                   * with it: the step catalogue, the add/remove
                                   * helpers, and `syncStepsWithFlow`, which
                                   * rewrote the public steps from a page-level
                                   * flow. The steps are edited as text below
                                   * and filled by enrichment from the business
                                   * when it has none.
                                   */
                                  const currentSteps = (editingBlockContent.steps as ProcessStep[]) || [];
                                  const lang = (settingsForm.website_language || 'en') as 'en' | 'es' | 'he';

                                  return (
                                  <>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.section_title}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        placeholder={language === 'he' ? 'איך זה עובד' : language === 'es' ? 'Cómo Funciona' : 'How It Works'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.section_subtitle}
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        placeholder={language === 'he' ? 'צעדים פשוטים להתחלה' : language === 'es' ? 'Pasos simples para comenzar' : 'Simple steps to get started'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>

                                    {/*
                                      ─────────────────────────────────────────
                                      THE BOOKING-FLOW BUILDER IS GONE.

                                      It asked "what happens after a client
                                      picks a service?" and let the owner
                                      compose one answer — book a time, pay
                                      online, fill an intake form — for the
                                      whole page.

                                      That question has no single answer any
                                      more. Every surface resolves the journey
                                      PER SERVICE, from the service's own facts:
                                      whether it is scheduled, how it collects
                                      payment, whether an intake form exists. A
                                      page-level flow composed here was
                                      overridden the moment it was read, and
                                      writing it kept a stale second answer
                                      alive in the block — which is precisely
                                      what used to make the editor and the live
                                      site disagree.

                                      The same builder was removed from the
                                      Client Journey tab for this reason. It
                                      came back into reach when this block
                                      stopped being hidden from the section
                                      list, and it would have reintroduced the
                                      same bug.

                                      The stored `client_flow` is deliberately
                                      NOT deleted: `components/website/blocks/
                                      index.tsx` still falls back to it for
                                      pages written before services carried
                                      their own journey facts. It is a legacy
                                      answer worth keeping and not worth
                                      offering to author.

                                      What each service puts a client through is
                                      shown, read-only, on that service's row in
                                      the services section.
                                    */}

                                    {/* Custom Process Steps Editor */}
                                    <div className="mt-4">
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {language === 'he' ? 'השלבים המוצגים באתר' : language === 'es' ? 'Pasos mostrados en el sitio' : 'Steps shown on website'}
                                      </label>
                                      <p className="text-xs text-[var(--v2-text-secondary)] mb-3">
                                        {language === 'he'
                                          ? 'ערוך את הכותרות והתיאורים שיוצגו באתר שלך'
                                          : language === 'es'
                                          ? 'Edita los títulos y descripciones mostrados en tu sitio'
                                          : 'Edit the titles and descriptions shown on your website'}
                                      </p>
                                      <ProcessStepEditor
                                        steps={currentSteps}
                                        onChange={(steps) => updateBlockField('steps', steps)}
                                        language={lang}
                                      />
                                    </div>
                                  </>
                                  );
                                })()}

                                {/* Generic Title/Subtitle for other blocks */}
                                {['testimonials', 'pricing', 'faq', 'features', 'stats', 'team', 'gallery', 'newsletter'].includes(block.block_type) && (
                                  <>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.section_title}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.section_subtitle}
                                      </label>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                  </>
                                )}

                                {/* Testimonials Block - Manual Entry with AI Enhancement */}
                                {block.block_type === 'testimonials' && (
                                  <div className="mt-4">
                                    <TestimonialEditor
                                      testimonials={(editingBlockContent.testimonials as TestimonialItem[]) || []}
                                      onChange={(testimonials) => updateBlockField('testimonials', testimonials)}
                                      onEnhanceWithAI={handleEnhanceTestimonial}
                                      isEnhancing={enhancingTestimonial}
                                      enhancingIndex={enhancingTestimonialIndex}
                                      language={(settingsForm.website_language || 'en') as 'en' | 'es' | 'he'}
                                    />
                                  </div>
                                )}

                                {/* Video Block */}
                                {block.block_type === 'video' && (
                                  <>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.section_title}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {labels.video_url}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.video_url as string) || ''}
                                        onChange={(e) => updateBlockField('video_url', e.target.value)}
                                        placeholder="https://youtube.com/..."
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                  </>
                                )}

                                {/* FAQ Block */}
                                {block.block_type === 'faq' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling FAQ section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'שאלות ותשובות' : language === 'es' ? 'Preguntas y Respuestas' : 'Questions & Answers'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const faqs = (editingBlockContent.faqs as Array<{ question: string; answer: string }>) || [];
                                            updateBlockField('faqs', [...faqs, { question: '', answer: '' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף שאלה' : language === 'es' ? 'Agregar Pregunta' : 'Add Question'}
                                        </button>
                                      </div>
                                      <div className="space-y-3">
                                        {((editingBlockContent.faqs as Array<{ question: string; answer: string }>) || []).map((faq, idx) => (
                                          <div key={idx} className="p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg space-y-2">
                                            <div className="flex items-center gap-2">
                                              <HelpCircle className="w-4 h-4 text-[#4F6EF7]" />
                                              <input
                                                type="text"
                                                value={faq.question}
                                                onChange={(e) => {
                                                  const faqs = [...(editingBlockContent.faqs as Array<{ question: string; answer: string }>)];
                                                  faqs[idx] = { ...faqs[idx], question: e.target.value };
                                                  updateBlockField('faqs', faqs);
                                                }}
                                                placeholder={language === 'he' ? 'שאלה...' : language === 'es' ? 'Pregunta...' : 'Question...'}
                                                className="flex-1 px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const faqs = [...(editingBlockContent.faqs as Array<{ question: string; answer: string }>)];
                                                  faqs.splice(idx, 1);
                                                  updateBlockField('faqs', faqs);
                                                }}
                                                className="p-1 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                            <textarea
                                              value={faq.answer}
                                              onChange={(e) => {
                                                const faqs = [...(editingBlockContent.faqs as Array<{ question: string; answer: string }>)];
                                                faqs[idx] = { ...faqs[idx], answer: e.target.value };
                                                updateBlockField('faqs', faqs);
                                              }}
                                              placeholder={language === 'he' ? 'תשובה...' : language === 'es' ? 'Respuesta...' : 'Answer...'}
                                              rows={2}
                                              className="w-full px-2 py-1 bg-transparent border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm resize-none"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Features Block */}
                                {block.block_type === 'features' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling features section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling features section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'תכונות' : language === 'es' ? 'Características' : 'Features'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const features = (editingBlockContent.features as Array<{ title: string; description: string; icon?: string }>) || [];
                                            updateBlockField('features', [...features, { title: '', description: '', icon: 'Star' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף תכונה' : language === 'es' ? 'Agregar' : 'Add Feature'}
                                        </button>
                                      </div>
                                      <div className="space-y-3">
                                        {((editingBlockContent.features as Array<{ title: string; description: string; icon?: string }>) || []).map((feature, idx) => (
                                          <div key={idx} className="p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg space-y-2">
                                            <div className="flex items-center gap-2">
                                              <Star className="w-4 h-4 text-[#4F6EF7]" />
                                              <input
                                                type="text"
                                                value={feature.title}
                                                onChange={(e) => {
                                                  const features = [...(editingBlockContent.features as Array<{ title: string; description: string; icon?: string }>)];
                                                  features[idx] = { ...features[idx], title: e.target.value };
                                                  updateBlockField('features', features);
                                                }}
                                                placeholder={language === 'he' ? 'כותרת...' : language === 'es' ? 'Título...' : 'Title...'}
                                                className="flex-1 px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm font-medium"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const features = [...(editingBlockContent.features as Array<{ title: string; description: string; icon?: string }>)];
                                                  features.splice(idx, 1);
                                                  updateBlockField('features', features);
                                                }}
                                                className="p-1 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                            <textarea
                                              value={feature.description}
                                              onChange={(e) => {
                                                const features = [...(editingBlockContent.features as Array<{ title: string; description: string; icon?: string }>)];
                                                features[idx] = { ...features[idx], description: e.target.value };
                                                updateBlockField('features', features);
                                              }}
                                              placeholder={language === 'he' ? 'תיאור...' : language === 'es' ? 'Descripción...' : 'Description...'}
                                              rows={2}
                                              className="w-full px-2 py-1 bg-transparent border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm resize-none"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Stats Block */}
                                {block.block_type === 'stats' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling stats section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'סטטיסטיקות' : language === 'es' ? 'Estadísticas' : 'Statistics'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const stats = (editingBlockContent.stats as Array<{ value: string; label: string }>) || [];
                                            updateBlockField('stats', [...stats, { value: '', label: '' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף' : language === 'es' ? 'Agregar' : 'Add Stat'}
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        {((editingBlockContent.stats as Array<{ value: string; label: string }>) || []).map((stat, idx) => (
                                          <div key={idx} className="p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg space-y-2 relative group">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const stats = [...(editingBlockContent.stats as Array<{ value: string; label: string }>)];
                                                stats.splice(idx, 1);
                                                updateBlockField('stats', stats);
                                              }}
                                              className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                            <input
                                              type="text"
                                              value={stat.value}
                                              onChange={(e) => {
                                                const stats = [...(editingBlockContent.stats as Array<{ value: string; label: string }>)];
                                                stats[idx] = { ...stats[idx], value: e.target.value };
                                                updateBlockField('stats', stats);
                                              }}
                                              placeholder={language === 'he' ? 'ערך (לדוג\' 500+)' : language === 'es' ? 'Valor (ej. 500+)' : 'Value (e.g. 500+)'}
                                              className="w-full px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-lg font-bold text-center"
                                            />
                                            <input
                                              type="text"
                                              value={stat.label}
                                              onChange={(e) => {
                                                const stats = [...(editingBlockContent.stats as Array<{ value: string; label: string }>)];
                                                stats[idx] = { ...stats[idx], label: e.target.value };
                                                updateBlockField('stats', stats);
                                              }}
                                              placeholder={language === 'he' ? 'תיאור...' : language === 'es' ? 'Etiqueta...' : 'Label...'}
                                              className="w-full px-2 py-1 bg-transparent text-[var(--v2-text-secondary)] focus:outline-none focus:border-[#4F6EF7] text-xs text-center"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Pricing Block */}
                                {block.block_type === 'pricing' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling pricing section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling pricing section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                    {/*
                      Prices come from the service, so they are shown, not typed.

                      Every plan here carries a `serviceId`, and
                      `blocks-with-content` rewrites its price, currency,
                      duration and journey from `scheduling_services` on every
                      read — so a price edited in this panel survived only until
                      the next page load. It was an input that looked like it
                      worked and silently did not. Same card as the website's
                      services section, and the one way to change a price is the
                      one that lasts: the service itself.
                    */}
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Package className="w-4 h-4 text-[#4F6EF7]" />
                                          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                                            {language === 'he' ? 'חבילות מחירים' : language === 'es' ? 'Planes de Precios' : 'Pricing Plans'}
                                          </span>
                                          <span className="text-xs px-2 py-0.5 bg-[#4F6EF7]/10 text-[#4F6EF7] rounded-full">
                                            {(editingBlockContent.plans as Array<unknown>)?.length || 0}
                                          </span>
                                        </div>
                                        {/* No "refresh" here: `handleRefreshServices` writes the
                                            `services` field, which a pricing block does not have. */}
                                        <button
                                          onClick={() => setIsConfigOpen(true)}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9]"
                                        >
                                          <Link2 className="w-3 h-3" />
                                          {labels.edit_services}
                                        </button>
                                      </div>

                                      {((editingBlockContent.plans as Array<{ name: string; price: string; description?: string; highlighted?: boolean; duration?: string; durationMinutes?: number }>) || []).length > 0 ? (
                                        <div className="grid gap-3">
                                          {((editingBlockContent.plans as Array<{ name: string; price: string; description?: string; highlighted?: boolean; duration?: string; durationMinutes?: number }>) || []).map((plan, idx) => (
                                            <div
                                              key={idx}
                                              className={`p-4 bg-gradient-to-r from-[var(--v2-surface)] to-transparent border rounded-xl transition-colors ${
                                                plan.highlighted
                                                  ? 'border-[#4F6EF7]'
                                                  : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/30'
                                              }`}
                                            >
                                              <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#4F6EF7]/10">
                                                  <DollarSign className="w-5 h-5 text-[#4F6EF7]" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-center justify-between gap-2">
                                                    <h4 className="font-medium truncate text-[var(--v2-text-primary)]">
                                                      {plan.name}
                                                    </h4>
                                                    <div className="flex items-center gap-2">
                                                      {plan.price && (
                                                        <span className="text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                                          {plan.price}
                                                        </span>
                                                      )}
                                                      {/* Presentation, not service data — this one stays editable. */}
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          const plans = [...((editingBlockContent.plans as Array<{ name: string; price: string; highlighted?: boolean }>) || [])];
                                                          plans[idx] = { ...plans[idx], highlighted: !plans[idx].highlighted };
                                                          updateBlockField('plans', plans);
                                                        }}
                                                        className={`p-1.5 rounded-lg transition-all ${
                                                          plan.highlighted
                                                            ? 'bg-[#4F6EF7]/10 text-[#4F6EF7] hover:bg-[#4F6EF7]/20'
                                                            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                                                        }`}
                                                        title={language === 'he' ? 'הדגש חבילה זו' : language === 'es' ? 'Destacar plan' : 'Highlight plan'}
                                                      >
                                                        <Star className="w-4 h-4" fill={plan.highlighted ? 'currentColor' : 'none'} />
                                                      </button>
                                                    </div>
                                                  </div>
                                                  {/* The service's own description, injected live — not bullets written about it. */}
                                                  {plan.description && (
                                                    <p className="text-xs text-[var(--v2-text-secondary)] mt-1 line-clamp-2">
                                                      {plan.description}
                                                    </p>
                                                  )}
                                                  {(plan.durationMinutes || plan.duration) && (
                                                    <div className="flex items-center gap-1 mt-2">
                                                      <Calendar className="w-3 h-3 text-[var(--v2-text-secondary)]" />
                                                      <span className="text-xs text-[var(--v2-text-secondary)]">
                                                        {plan.durationMinutes
                                                          ? `${plan.durationMinutes} ${language === 'he' ? 'דקות' : language === 'es' ? 'minutos' : 'minutes'}`
                                                          : plan.duration}
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="p-6 bg-[var(--v2-surface)] border border-dashed border-[var(--v2-border)] rounded-xl text-center">
                                          <Package className="w-8 h-8 text-[var(--v2-text-secondary)] mx-auto mb-2 opacity-50" />
                                          <p className="text-sm text-[var(--v2-text-secondary)]">
                                            {labels.no_services_hint}
                                          </p>
                                          <button
                                            onClick={() => setIsConfigOpen(true)}
                                            className="inline-flex items-center gap-1 text-sm text-[#4F6EF7] hover:text-[#3D5BD9] mt-2"
                                          >
                                            <Plus className="w-4 h-4" />
                                            {language === 'he' ? 'הוסף שירותים' : language === 'es' ? 'Agregar servicios' : 'Add services'}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}

                                {/* Contact Form Block */}
                                {block.block_type === 'contact_form' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling contact form section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling contact form section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'טקסט כפתור שליחה' : language === 'es' ? 'Texto del Botón' : 'Submit Button Text'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.submit_text as string) || ''}
                                        onChange={(e) => updateBlockField('submit_text', e.target.value)}
                                        placeholder={language === 'he' ? 'שלח הודעה' : language === 'es' ? 'Enviar Mensaje' : 'Send Message'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>

                                    {/* Contact Info Sidebar Fields */}
                                    <div className="border-t border-[var(--v2-border)] pt-4 mt-4">
                                      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3">
                                        {language === 'he' ? 'פרטי התקשרות (סרגל צד)' : language === 'es' ? 'Información de Contacto (Barra lateral)' : 'Contact Info (Sidebar)'}
                                      </h4>
                                      <div className="space-y-3">
                                        {/* Sourced, not typed. The public page
                                            reads these from the business profile
                                            and nothing else, so an editable box
                                            here would promise an override that no
                                            longer happens. */}
                                        {renderProfileContactFields()}
                                        <div>
                                          <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                            {language === 'he' ? 'שעות פעילות' : language === 'es' ? 'Horario de Atención' : 'Business Hours'}
                                          </label>
                                          {/* Derived from the availability the
                                              booking calendar runs on, so this
                                              section and the footer cannot give
                                              two different answers about when
                                              the business opens. */}
                                          {renderProfileHours()}
                                        </div>
                                      </div>
                                      <p className="mt-2 text-xs text-[var(--v2-text-muted)]">
                                        {language === 'he' ? 'השדות האלה יוצגו בסרגל צד ליד הטופס' : language === 'es' ? 'Estos campos aparecerán en una barra lateral junto al formulario' : 'These fields will appear in a sidebar next to the form'}
                                      </p>
                                    </div>

                                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                      <p className="text-sm text-blue-700 dark:text-blue-300">
                                        {language === 'he' ? 'טפסים שנשלחו ייצרו אנשי קשר חדשים ב-CRM שלך אוטומטית.' : language === 'es' ? 'Los formularios enviados crearán contactos en tu CRM automáticamente.' : 'Submitted forms will automatically create contacts in your CRM.'}
                                      </p>
                                    </div>
                                  </>
                                )}


                                {/* Booking Widget Block */}
                                {block.block_type === 'booking_widget' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling booking section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling booking section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <input
                                        type="checkbox"
                                        id="show_all_services"
                                        checked={(editingBlockContent.show_all_services as boolean) ?? true}
                                        onChange={(e) => updateBlockField('show_all_services', e.target.checked)}
                                        className="w-4 h-4 rounded border-[var(--v2-border)] text-[#4F6EF7] focus:ring-[#4F6EF7]"
                                      />
                                      <label htmlFor="show_all_services" className="text-sm text-[var(--v2-text-secondary)]">
                                        {language === 'he' ? 'הצג את כל השירותים' : language === 'es' ? 'Mostrar todos los servicios' : 'Show all services'}
                                      </label>
                                    </div>
                                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center gap-3">
                                      <Calendar className="w-5 h-5 text-green-600 dark:text-green-400" />
                                      <p className="text-sm text-green-700 dark:text-green-300">
                                        {language === 'he' ? 'לוח זמינות נשלף אוטומטית מיכולת התיאום שלך.' : language === 'es' ? 'El calendario se obtiene automáticamente de tu Programación.' : 'Availability is automatically fetched from your Scheduling capability.'}
                                      </p>
                                    </div>
                                  </>
                                )}

                                {/* Payment Button Block */}
                                {block.block_type === 'payment_button' && (
                                  <>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'טקסט כפתור' : language === 'es' ? 'Texto del Botón' : 'Button Text'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.button_text as string) || ''}
                                        onChange={(e) => updateBlockField('button_text', e.target.value)}
                                        placeholder={language === 'he' ? 'שלם עכשיו' : language === 'es' ? 'Pagar Ahora' : 'Pay Now'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {language === 'he' ? 'סכום' : language === 'es' ? 'Monto' : 'Amount'}
                                        </label>
                                        <input
                                          type="number"
                                          value={(editingBlockContent.amount as number) || ''}
                                          onChange={(e) => updateBlockField('amount', parseFloat(e.target.value) || 0)}
                                          className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                          {language === 'he' ? 'מטבע' : language === 'es' ? 'Moneda' : 'Currency'}
                                        </label>
                                        <Select
                                          value={(editingBlockContent.currency as string) || 'USD'}
                                          onValueChange={(value) => updateBlockField('currency', value)}
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="USD">$ USD</SelectItem>
                                            <SelectItem value="EUR">€ EUR</SelectItem>
                                            <SelectItem value="GBP">£ GBP</SelectItem>
                                            <SelectItem value="ILS">₪ ILS</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'תיאור מוצר' : language === 'es' ? 'Descripción del Producto' : 'Product Description'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.description as string) || ''}
                                        onChange={(e) => updateBlockField('description', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex items-center gap-3">
                                      <CreditCard className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                                      <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                        {language === 'he' ? 'תשלומים מעובדים דרך Stripe Connect.' : language === 'es' ? 'Los pagos se procesan a través de Stripe Connect.' : 'Payments are processed through Stripe Connect.'}
                                      </p>
                                    </div>
                                  </>
                                )}

                                {/* Team Block */}
                                {block.block_type === 'team' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling team section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'חברי צוות' : language === 'es' ? 'Miembros del Equipo' : 'Team Members'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const members = (editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>) || [];
                                            updateBlockField('members', [...members, { name: '', role: '', bio: '', image: '' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף חבר צוות' : language === 'es' ? 'Agregar Miembro' : 'Add Member'}
                                        </button>
                                      </div>
                                      <div className="space-y-4">
                                        {((editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>) || []).map((member, idx) => (
                                          <div key={idx} className="p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg space-y-3">
                                            <div className="flex items-start gap-3">
                                              <div className="w-16 h-16 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center overflow-hidden flex-shrink-0">
                                                {member.image ? (
                                                  <img src={member.image} alt={member.name} className="w-full h-full object-cover" />
                                                ) : (
                                                  <User className="w-6 h-6 text-[var(--v2-text-muted)]" />
                                                )}
                                              </div>
                                              <div className="flex-1 space-y-2">
                                                <input
                                                  type="text"
                                                  value={member.name}
                                                  onChange={(e) => {
                                                    const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                    members[idx] = { ...members[idx], name: e.target.value };
                                                    updateBlockField('members', members);
                                                  }}
                                                  placeholder={language === 'he' ? 'שם...' : language === 'es' ? 'Nombre...' : 'Name...'}
                                                  className="w-full px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] font-medium"
                                                />
                                                <input
                                                  type="text"
                                                  value={member.role}
                                                  onChange={(e) => {
                                                    const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                    members[idx] = { ...members[idx], role: e.target.value };
                                                    updateBlockField('members', members);
                                                  }}
                                                  placeholder={language === 'he' ? 'תפקיד...' : language === 'es' ? 'Rol...' : 'Role...'}
                                                  className="w-full px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-secondary)] focus:outline-none focus:border-[#4F6EF7] text-sm"
                                                />
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                  members.splice(idx, 1);
                                                  updateBlockField('members', members);
                                                }}
                                                className="p-1 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                            <MediaUploader
                                              section="team"
                                              aspect="square"
                                              value={member.image || ''}
                                              onChange={(url) => {
                                                const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                members[idx] = { ...members[idx], image: url };
                                                updateBlockField('members', members);
                                              }}
                                              onRemove={() => {
                                                const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                members[idx] = { ...members[idx], image: '' };
                                                updateBlockField('members', members);
                                              }}
                                              placeholder={language === 'he' ? 'תמונת פרופיל' : language === 'es' ? 'Foto de perfil' : 'Profile photo'}
                                              previewClassName="w-full h-24"
                                              showUrlInput={true}
                                            />
                                            <textarea
                                              value={member.bio || ''}
                                              onChange={(e) => {
                                                const members = [...(editingBlockContent.members as Array<{ name: string; role: string; bio?: string; image?: string }>)];
                                                members[idx] = { ...members[idx], bio: e.target.value };
                                                updateBlockField('members', members);
                                              }}
                                              placeholder={language === 'he' ? 'ביוגרפיה קצרה...' : language === 'es' ? 'Biografía breve...' : 'Short bio...'}
                                              rows={2}
                                              className="w-full px-2 py-1 bg-transparent border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm resize-none"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Gallery Block */}
                                {block.block_type === 'gallery' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling gallery section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling gallery section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'תמונות' : language === 'es' ? 'Imágenes' : 'Images'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const images = (editingBlockContent.images as Array<{ url: string; caption?: string }>) || [];
                                            updateBlockField('images', [...images, { url: '', caption: '' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף תמונה' : language === 'es' ? 'Agregar Imagen' : 'Add Image'}
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        {((editingBlockContent.images as Array<{ url: string; caption?: string }>) || []).map((image, idx) => (
                                          <div key={idx} className="space-y-1">
                                            <MediaUploader
                                              section="gallery"
                                              aspect="wide"
                                              value={image.url}
                                              onChange={(url) => {
                                                const images = [...(editingBlockContent.images as Array<{ url: string; caption?: string }>)];
                                                images[idx] = { ...images[idx], url };
                                                updateBlockField('images', images);
                                              }}
                                              onRemove={() => {
                                                const images = [...(editingBlockContent.images as Array<{ url: string; caption?: string }>)];
                                                images.splice(idx, 1);
                                                updateBlockField('images', images);
                                              }}
                                              placeholder={language === 'he' ? 'העלה תמונה' : language === 'es' ? 'Subir imagen' : 'Upload image'}
                                              previewClassName="aspect-square"
                                              showUrlInput={false}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Newsletter Block */}
                                {block.block_type === 'newsletter' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling newsletter section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_subtitle}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a compelling newsletter section subtitle')}
                                          disabled={generatingAI === `${block.id}-subtitle`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-subtitle` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        value={(editingBlockContent.subtitle as string) || ''}
                                        onChange={(e) => updateBlockField('subtitle', e.target.value)}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'טקסט כפתור הרשמה' : language === 'es' ? 'Texto del Botón' : 'Subscribe Button Text'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.button_text as string) || ''}
                                        onChange={(e) => updateBlockField('button_text', e.target.value)}
                                        placeholder={language === 'he' ? 'הירשם' : language === 'es' ? 'Suscribirse' : 'Subscribe'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'Placeholder לאימייל' : language === 'es' ? 'Placeholder del Email' : 'Email Placeholder'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.placeholder as string) || ''}
                                        onChange={(e) => updateBlockField('placeholder', e.target.value)}
                                        placeholder={language === 'he' ? 'הזן את האימייל שלך' : language === 'es' ? 'Ingresa tu email' : 'Enter your email'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                  </>
                                )}

                                {/* Logo Cloud Block */}
                                {block.block_type === 'logo_cloud' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a compelling logo cloud section title')}
                                          disabled={generatingAI === `${block.id}-title`}
                                          className="flex items-center gap-1 text-xs text-[#4F6EF7] hover:text-[#3D5BD9] disabled:opacity-50"
                                        >
                                          {generatingAI === `${block.id}-title` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Wand2 className="w-3 h-3" />
                                          )}
                                          {labels.generate_with_ai}
                                        </button>
                                      </div>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.title as string) || ''}
                                        onChange={(e) => updateBlockField('title', e.target.value)}
                                        placeholder={language === 'he' ? 'לקוחות שסמכו עלינו' : language === 'es' ? 'Clientes que Confiaron' : 'Trusted By'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'לוגואים' : language === 'es' ? 'Logos' : 'Logos'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const logos = (editingBlockContent.logos as Array<{ url: string; name: string }>) || [];
                                            updateBlockField('logos', [...logos, { url: '', name: '' }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף לוגו' : language === 'es' ? 'Agregar Logo' : 'Add Logo'}
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3">
                                        {((editingBlockContent.logos as Array<{ url: string; name: string }>) || []).map((logo, idx) => (
                                          <div key={idx} className="space-y-2">
                                            <MediaUploader
                                              section="logo_cloud"
                                              aspect="square"
                                              value={logo.url}
                                              onChange={(url) => {
                                                const logos = [...(editingBlockContent.logos as Array<{ url: string; name: string }>)];
                                                logos[idx] = { ...logos[idx], url };
                                                updateBlockField('logos', logos);
                                              }}
                                              onRemove={() => {
                                                const logos = [...(editingBlockContent.logos as Array<{ url: string; name: string }>)];
                                                logos.splice(idx, 1);
                                                updateBlockField('logos', logos);
                                              }}
                                              placeholder={language === 'he' ? 'העלה לוגו' : language === 'es' ? 'Subir logo' : 'Upload logo'}
                                              previewClassName="aspect-video"
                                              showUrlInput={false}
                                            />
                                            <input
                                              type="text"
                                              value={logo.name}
                                              onChange={(e) => {
                                                const logos = [...(editingBlockContent.logos as Array<{ url: string; name: string }>)];
                                                logos[idx] = { ...logos[idx], name: e.target.value };
                                                updateBlockField('logos', logos);
                                              }}
                                              placeholder={language === 'he' ? 'שם...' : language === 'es' ? 'Nombre...' : 'Name...'}
                                              className="w-full px-2 py-1 bg-transparent border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-xs"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* Footer Block */}
                                {block.block_type === 'footer' && (
                                  <>
                                    {/* The name is the business's, not this
                                        page's — it is shown with the rest of
                                        the profile-sourced details below, and
                                        changed in one place. */}
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                                        {language === 'he' ? 'תיאור קצר' : language === 'es' ? 'Descripción Breve' : 'Tagline'}
                                      </label>
                                      <input
                                        type="text"
                                        value={(editingBlockContent.tagline as string) || ''}
                                        onChange={(e) => updateBlockField('tagline', e.target.value)}
                                        placeholder={language === 'he' ? 'משפט תיאור קצר...' : language === 'es' ? 'Frase descriptiva...' : 'Short description...'}
                                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                                      />
                                    </div>
                                    {/* The footer wears the logo unless told not
                                        to — the opposite of the header, which can
                                        show a wordmark instead and so has to be
                                        asked. A footer has no such alternative. */}
                                    {businessProfile?.logo_url && (
                                      <div>
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                          {language === 'he' ? 'לוגו' : 'Logo'}
                                        </label>
                                        <label className="flex items-center gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={editingBlockContent.show_logo !== false}
                                            onChange={(e) => updateBlockField('show_logo', e.target.checked)}
                                            className="w-4 h-4 accent-[#4F6EF7]"
                                          />
                                          <img src={businessProfile.logo_url as string} alt="" className="h-8 w-auto object-contain" />
                                          <span className="text-sm text-[var(--v2-text-secondary)]">
                                            {language === 'he' ? 'הצג את הלוגו בתחתית העמוד' : language === 'es' ? 'Mostrar el logo en el pie de página' : 'Show the logo in the footer'}
                                          </span>
                                        </label>
                                      </div>
                                    )}

                                    {/* One source of truth. These were three
                                        editable boxes here AND three more in the
                                        contact block, so one page could carry two
                                        different phone numbers with nothing to say
                                        which was real. */}
                                    {renderProfileContactFields()}
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {language === 'he' ? 'רשתות חברתיות' : language === 'es' ? 'Redes Sociales' : 'Social Links'}
                                      </label>
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          <span className="w-20 text-xs text-[var(--v2-text-muted)]">Facebook</span>
                                          <input
                                            type="url"
                                            value={((editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string })?.facebook as string) || ''}
                                            onChange={(e) => updateBlockField('social_links', {
                                              ...(editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string } || {}),
                                              facebook: e.target.value
                                            })}
                                            placeholder="https://facebook.com/..."
                                            dir="ltr"
                                            className="flex-1 px-2 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#4F6EF7] text-sm"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="w-20 text-xs text-[var(--v2-text-muted)]">Instagram</span>
                                          <input
                                            type="url"
                                            value={((editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string })?.instagram as string) || ''}
                                            onChange={(e) => updateBlockField('social_links', {
                                              ...(editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string } || {}),
                                              instagram: e.target.value
                                            })}
                                            placeholder="https://instagram.com/..."
                                            dir="ltr"
                                            className="flex-1 px-2 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#4F6EF7] text-sm"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="w-20 text-xs text-[var(--v2-text-muted)]">LinkedIn</span>
                                          <input
                                            type="url"
                                            value={((editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string })?.linkedin as string) || ''}
                                            onChange={(e) => updateBlockField('social_links', {
                                              ...(editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string } || {}),
                                              linkedin: e.target.value
                                            })}
                                            placeholder="https://linkedin.com/..."
                                            dir="ltr"
                                            className="flex-1 px-2 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#4F6EF7] text-sm"
                                          />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="w-20 text-xs text-[var(--v2-text-muted)]">Twitter/X</span>
                                          <input
                                            type="url"
                                            value={((editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string })?.twitter as string) || ''}
                                            onChange={(e) => updateBlockField('social_links', {
                                              ...(editingBlockContent.social_links as { facebook?: string; instagram?: string; linkedin?: string; twitter?: string } || {}),
                                              twitter: e.target.value
                                            })}
                                            placeholder="https://twitter.com/..."
                                            dir="ltr"
                                            className="flex-1 px-2 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#4F6EF7] text-sm"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                    {/* A switch, like every other on/off in the
                                        platform. A bare checkbox beside styled
                                        controls read as a form field rather than
                                        a setting. */}
                                    <label
                                      htmlFor="show_powered_by"
                                      className="flex items-center justify-between gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg cursor-pointer"
                                    >
                                      <span className="text-sm text-[var(--v2-text-secondary)]">
                                        {language === 'he' ? 'הצג "מופעל על ידי AgentsPilot"' : language === 'es' ? 'Mostrar "Desarrollado por AgentsPilot"' : 'Show "Powered by AgentsPilot"'}
                                      </span>
                                      <Switch
                                        id="show_powered_by"
                                        /* Inline for the same reason as the
                                           services switch above: `cn` does not
                                           merge conflicting Tailwind classes. */
                                        style={
                                          (editingBlockContent.show_powered_by as boolean)
                                            ? { backgroundColor: WEBSITE_COLOR }
                                            : undefined
                                        }
                                        checked={(editingBlockContent.show_powered_by as boolean) ?? false}
                                        onCheckedChange={(checked) => updateBlockField('show_powered_by', checked)}
                                      />
                                    </label>
                                  </>
                                )}

                                {/* Save Button */}
                                <div className="flex justify-end pt-2">
                                  <button
                                    onClick={() => handleSaveBlockContent(block.id)}
                                    disabled={savingBlock}
                                    className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-all disabled:opacity-50"
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {savingBlock ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Save className="w-4 h-4" />
                                    )}
                                    {labels.save_block}
                                  </button>
                                </div>
                              </div>
                              </div>
                            )}
                          </div>
                        </SortableBlockItem>
                      );
                    })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {/* Design Tab */}
            {/* No website, and none needed: landing pages and smart links are
                this business's online presence, so they are what Overview
                shows. */}
            {viewMode === 'overview' && !page && (
              <div className="space-y-6">{renderLeadGeneration()}</div>
            )}

            {viewMode === 'design' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {labels.design_title}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                    {labels.design_desc}
                  </p>
                </div>

                <div className="space-y-6 max-w-xl">
                  {/* Primary Color */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.primary_color}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <input
                          type="color"
                          value={designForm.primaryColor}
                          onChange={(e) => setDesignForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                          className="w-12 h-10 rounded-lg cursor-pointer border border-[var(--v2-border)] bg-transparent"
                          style={{ padding: 0 }}
                        />
                      </div>
                      <input
                        type="text"
                        value={designForm.primaryColor}
                        onChange={(e) => setDesignForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] font-mono text-sm uppercase"
                        placeholder="#4F6EF7"
                      />
                    </div>
                  </div>

                  {/* Secondary Color */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {language === 'he' ? 'צבע משני' : language === 'es' ? 'Color Secundario' : 'Secondary Color'}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <input
                          type="color"
                          value={designForm.secondaryColor}
                          onChange={(e) => setDesignForm(prev => ({ ...prev, secondaryColor: e.target.value }))}
                          className="w-12 h-10 rounded-lg cursor-pointer border border-[var(--v2-border)] bg-transparent"
                          style={{ padding: 0 }}
                        />
                      </div>
                      <input
                        type="text"
                        value={designForm.secondaryColor}
                        onChange={(e) => setDesignForm(prev => ({ ...prev, secondaryColor: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] font-mono text-sm uppercase"
                        placeholder="#6366F1"
                      />
                    </div>
                  </div>

                  {/*
                    * Both faces, shown rather than named.
                    *
                    * These were two literal lists of six families, and not one
                    * of them was a face any template uses — so a business on
                    * Bloom (Josefin Sans) opened this tab and found an empty
                    * dropdown, because Radix had no item matching the saved
                    * value. The font was saved and rendering correctly the
                    * whole time; only the control could not describe it.
                    */}
                  <FontPicker
                    label={labels.font_heading}
                    value={designForm.headingFont}
                    choices={HEADING_FONTS}
                    latinOnlyLabel={labels.font_latin_only}
                    onChange={(value) => setDesignForm(prev => ({ ...prev, headingFont: value }))}
                  />

                  <FontPicker
                    label={labels.font_body}
                    value={designForm.bodyFont}
                    choices={BODY_FONTS}
                    latinOnlyLabel={labels.font_latin_only}
                    onChange={(value) => setDesignForm(prev => ({ ...prev, bodyFont: value }))}
                  />
                </div>

                {/* Save Message */}
                {saveMessage && (
                  <div className={`mt-4 p-3 rounded-lg text-sm ${
                    saveMessage.type === 'success'
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                  }`}>
                    {saveMessage.text}
                  </div>
                )}

                <div className="mt-6 pt-6 border-t border-[var(--v2-border)] flex justify-end">
                  <button
                    onClick={handleSaveDesign}
                    disabled={savingDesign}
                    className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-all disabled:opacity-50"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {savingDesign ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {labels.saving}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {labels.save_changes}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Settings Tab */}
            {viewMode === 'settings' && !page && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                {/*
                  The address is the business's, not the website's.
                  
                  This said the settings "belong to a website — create one from
                  Templates and they will appear here", which stopped being true
                  the moment a landing page could be published: that page goes
                  live under an address, and the business had nowhere to see it.
                  A business with no website still has an address, and this is
                  where it is shown.
                */}
                {subdomain ? (
                  <>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      {labels.settings_address_label}
                    </label>
                    <div
                      className="flex items-center gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      dir="ltr"
                    >
                      <Globe className="w-5 h-5 text-[var(--v2-text-muted)] flex-shrink-0" />
                      <span className="flex-1 text-sm font-mono text-[var(--v2-text-secondary)]">
                        {subdomain}.agentspilot.com
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-2">
                      {labels.settings_address_hint}
                    </p>
                  </>
                ) : (
                  <div className="text-center">
                    <Globe className="w-8 h-8 mx-auto mb-3 text-[var(--v2-text-muted)] opacity-50" />
                    <p className="text-sm text-[var(--v2-text-secondary)]">
                      {labels.settings_needs_page}
                    </p>
                  </div>
                )}
              </div>
            )}

            {viewMode === 'settings' && page && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {labels.settings_title}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                    {labels.settings_desc}
                  </p>
                </div>

                <div className="space-y-6 max-w-xl">
                  {/* Website Content Language */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {language === 'he' ? 'שפת התוכן של האתר' : language === 'es' ? 'Idioma del Contenido' : 'Website Content Language'}
                    </label>
                    <p className="text-xs text-[var(--v2-text-muted)] mb-2">
                      {language === 'he'
                        ? 'בחר את השפה בה יופק התוכן של האתר שלך'
                        : language === 'es'
                        ? 'Selecciona el idioma del contenido de tu sitio web'
                        : 'Select the language for your website content generation'}
                    </p>
                    <Select
                      value={settingsForm.website_language}
                      onValueChange={(value: 'en' | 'es' | 'he') => setSettingsForm(prev => ({ ...prev, website_language: value }))}
                    >
                      <SelectTrigger className="w-full max-w-xs">
                        <SelectValue>
                          {settingsForm.website_language === 'en' && '🇺🇸 English'}
                          {settingsForm.website_language === 'es' && '🇪🇸 Español'}
                          {settingsForm.website_language === 'he' && '🇮🇱 עברית'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">🇺🇸 English</SelectItem>
                        <SelectItem value="es">🇪🇸 Español</SelectItem>
                        <SelectItem value="he">🇮🇱 עברית</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Subdomain */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.subdomain}
                      {businessProfile?.company_name && (
                        <span className="ml-2 text-xs font-normal text-[var(--v2-text-muted)]">
                          ({labels.generated_from_business})
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={subdomain}
                        readOnly={!!businessProfile?.company_name}
                        onChange={(e) => {
                          if (!businessProfile?.company_name) {
                            setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                            checkSubdomainAvailability(e.target.value);
                          }
                        }}
                        placeholder="your-business"
                        className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none ${
                          businessProfile?.company_name
                            ? 'bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-secondary)] cursor-not-allowed'
                            : 'bg-[var(--v2-bg)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:ring-2 focus:ring-[#4F6EF7]'
                        }`}
                      />
                      <span className="text-[var(--v2-text-muted)]">.agentpilot.io</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
                      {labels.subdomain_desc} https://{subdomain || 'your-business'}.agentpilot.io
                    </p>
                  </div>

                  {/* Page Title */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.meta_title}
                    </label>
                    <input
                      type="text"
                      value={settingsForm.title}
                      onChange={(e) => setSettingsForm(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                    />
                  </div>

                  {/* Meta Description */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.meta_description}
                    </label>
                    <textarea
                      rows={3}
                      value={settingsForm.meta_description}
                      onChange={(e) => setSettingsForm(prev => ({ ...prev, meta_description: e.target.value }))}
                      className="w-full px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                    />
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-[var(--v2-border)] flex items-center justify-between">
                  {/* Save feedback message */}
                  {saveMessage && (
                    <div className={`flex items-center gap-2 text-sm ${
                      saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {saveMessage.type === 'success' ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                      {saveMessage.text}
                    </div>
                  )}
                  {!saveMessage && <div />}
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium bg-[#4F6EF7] hover:bg-[#3D5BD9] transition-all disabled:opacity-50"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {labels.saving}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {labels.save_changes}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Templates Tab */}
            {viewMode === 'templates' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {labels.templates_title}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                    {labels.templates_desc}
                  </p>
                </div>

                {/* Warning banner */}
                <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {labels.template_warning}
                    </p>
                  </div>
                </div>

                {/* Current template indicator */}
                {currentTemplateId && (
                  <div className="mb-6 p-4 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                    <p className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                      {labels.current_template}
                    </p>
                    <p className="font-medium text-[var(--v2-text-primary)]">
                      {getTranslatedTemplateName(templates.find(t => t.id === currentTemplateId)?.name || currentTemplateId || '', language, currentTemplateId)}
                    </p>
                  </div>
                )}

                {/* Template Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {templates.map((template) => {
                    // No page yet means no current template — picking one here
                    // is what creates the site.
                    // The BUSINESS's template, not the open page's. Keyed off
                    // `page.template_id` nothing was ever marked for a business
                    // without a website — which is exactly the business that
                    // needs to see which look its landing pages and invoices
                    // are wearing.
                    const isCurrentTemplate = template.id === currentTemplateId;
                    const primaryColor = getTemplatePrimaryColor(template);
                    const secondaryColor = getTemplateSecondaryColor(template);
                    const accentColor = template.theme?.accent_color || secondaryColor;

                    return (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className={`group bg-[var(--v2-bg)] border text-start transition-all overflow-hidden cursor-pointer ${
                          isCurrentTemplate
                            ? 'border-[#4F6EF7] ring-2 ring-[#4F6EF7]/20'
                            : 'border-[var(--v2-border)] hover:border-[#4F6EF7]'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                        onClick={() => {
                          if (applyingTemplate) return;
                          // The selected card unselects — but only while nothing
                          // has been built from it. A website or landing page is
                          // generated FROM the template, so clearing the choice
                          // underneath one leaves a live surface wearing a look
                          // the business can no longer name or change.
                          if (isCurrentTemplate) {
                            if (allPages.length === 0) handleClearTemplate();
                            return;
                          }
                          handleApplyTemplate(template.id);
                        }}
                        title={
                          isCurrentTemplate
                            ? (allPages.length === 0 ? labels.template_unselect : labels.template_in_use)
                            : undefined
                        }
                      >
                        {/* Color Preview Bar */}
                        <div className="h-16 relative overflow-hidden">
                          <div
                            className="absolute inset-0"
                            style={{
                              background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor} 50%, ${secondaryColor} 50%, ${secondaryColor} 100%)`
                            }}
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 h-1.5"
                            style={{ backgroundColor: accentColor }}
                          />
                          {/* Current template badge */}
                          {isCurrentTemplate && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
                              <Check className="w-3 h-3 text-[#4F6EF7]" />
                            </div>
                          )}
                        </div>

                        {/* Template Info */}
                        <div className="p-2.5">
                          <h3 className="text-xs font-semibold text-[var(--v2-text-primary)] mb-0.5 truncate">
                            {getTranslatedTemplateName(template.name, language, template.id)}
                          </h3>
                          <p className="text-[10px] text-[var(--v2-text-muted)]">
                            {template.theme?.brand_voice
                              ? getTranslatedBrandVoice(template.theme.brand_voice, language)
                              : getTranslatedVertical(template.vertical, language)}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Wizard Tab */}
            {viewMode === 'wizard' && generating && (
              // Generation takes tens of seconds. Without this the finish
              // button simply stopped responding, which reads as a broken
              // wizard rather than as work being done.
              <div
                className="fixed inset-0 z-50 flex items-center justify-center"
                style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(2px)' }}
                role="status"
                aria-live="polite"
              >
                <div
                  className="px-8 py-7 text-center max-w-sm mx-4"
                  style={{
                    background: 'var(--v2-surface)',
                    border: '1px solid var(--v2-border)',
                    borderRadius: 'var(--v2-radius-card)',
                  }}
                >
                  <div
                    className="mx-auto mb-4 animate-spin"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: '2px solid var(--v2-border)',
                      borderTopColor: '#4F6EF7',
                    }}
                  />
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">{labels.writing_title}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--v2-text-muted)]">{labels.writing_body}</p>
                </div>
              </div>
            )}

            {viewMode === 'wizard' && (
              <WebsiteSetupWizard
                templates={templates}
                currentTemplateId={page?.template_id ?? undefined}
                recommendedTemplateId={recommendedTemplateId}
                currentLogoUrl={businessProfile?.logo_url as string | undefined}
                currentClientFlow={clientFlow.length > 0 ? clientFlow : undefined}
                currentHiddenServiceNames={
                  (blocks.find(b => b.block_type === 'services')?.content?.services as Array<{ name: string; hidden?: boolean }> || [])
                    .filter(s => s.hidden)
                    .map(s => s.name)
                }
                subdomain={subdomain}
                pageId={page?.id}
                onComplete={handleWizardComplete}
                onSkip={handleWizardSkip}
                onBeforePreview={handleBeforePreview}
                embedded={true}
              />
            )}
          </>
        )}
      </div>

      {/* Create Landing Page Modal */}
      {showCreatePageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCreatePageModal(false)}
          />

          {/* Modal */}
          <div
            /* Capped and scrollable. A centred `fixed` panel taller than the
               screen overflows in BOTH directions, and the part above the top
               edge cannot be reached by scrolling anything. `dvh` because a
               phone's `vh` excludes the address bar. */
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 sm:p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[calc(100ddvh-2rem)] overflow-y-auto"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                {labels.add_landing_page}
              </h2>
              <button
                onClick={() => setShowCreatePageModal(false)}
                className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Page Title */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                  {labels.meta_title}
                </label>
                <input
                  type="text"
                  value={newPageTitle}
                  onChange={(e) => setNewPageTitle(e.target.value)}
                  placeholder={labels.page_title_placeholder}
                  className="w-full px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                />
              </div>

              {/* URL Slug */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                  {labels.page_slug}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--v2-text-muted)]">/</span>
                  <input
                    type="text"
                    value={newPageSlug}
                    onChange={(e) => setNewPageSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder={labels.page_slug_placeholder}
                    className="flex-1 px-4 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] font-mono"
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
                  {page?.subdomain}.agentpilot.io/{newPageSlug || 'your-page-slug'}
                </p>
              </div>

              {/* Template Selection */}
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                  {labels.tab_templates}
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplateForNewPage(template.id)}
                      className={`p-3 text-start border transition-all ${
                        selectedTemplateForNewPage === template.id
                          ? 'border-[#4F6EF7] bg-[#4F6EF7]/5'
                          : 'border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                        {getTranslatedTemplateName(template.name, language, template.id)}
                      </p>
                      <p className="text-xs text-[var(--v2-text-muted)] capitalize">
                        {getTranslatedVertical(template.vertical, language)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-[var(--v2-border)]">
              <button
                onClick={() => setShowCreatePageModal(false)}
                className="px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {labels.cancel}
              </button>
              <button
                onClick={handleCreateLandingPage}
                disabled={creatingPage || !newPageTitle.trim()}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-all disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {creatingPage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {labels.creating_page}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {labels.create_page}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        The address, confirmed before the site goes live.

        The prefix is generated, and publishing used to put it on the internet
        without ever showing it — yet it is what the owner prints, sends and is
        found at. Shown once, on the first publish only: re-publishing is not
        the moment to invite a change, because the old address is already
        written down somewhere.
      */}
      {publishAddressOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPublishAddressOpen(false)} />
          <div
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] w-full max-w-md mx-4 p-4 sm:p-6 max-h-[calc(100ddvh-2rem)] overflow-y-auto"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              {labels.publish_address_title}
            </h3>
            <p className="mt-1 text-sm text-[var(--v2-text-muted)]">
              {labels.publish_address_subtitle}
            </p>

            {/*
              ─────────────────────────────────────────────────────────────────
              THE LAST MOMENT BEFORE IT IS PUBLIC.

              This dialog asks for an address and said nothing about what
              pressing the button does. The page it publishes was written by a
              model from an onboarding conversation — its wording, its prices,
              its photographs — and most owners will not have read it line by
              line. Publishing is the first time anyone else can.

              Placed here rather than on the page behind it because this is the
              only screen every publish passes through, and a warning somewhere
              else is a warning that can be scrolled past.
            */}
            <div
              className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {t('presence.review.title')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                {t('presence.review.body')}
              </p>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={publishAddressValue}
                autoFocus
                onChange={(e) => {
                  const next = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  setPublishAddressValue(next);
                  checkSubdomainAvailability(next);
                }}
                className="flex-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
              />
              <span className="text-sm text-[var(--v2-text-muted)]">.agentpilot.io</span>
            </div>

            {/* Said plainly rather than left to a red border: the owner is about
                to commit this address. */}
            <p className="mt-2 text-xs min-h-[1rem]">
              {checkingSubdomain ? (
                <span className="text-[var(--v2-text-muted)]">{labels.checking}</span>
              ) : publishAddressValue && publishAddressValue !== page?.subdomain && subdomainAvailable === false ? (
                <span className="text-red-600 dark:text-red-400">{labels.subdomain_taken}</span>
              ) : (
                <span className="text-[var(--v2-text-muted)]">
                  https://{publishAddressValue || 'your-business'}.agentpilot.io
                </span>
              )}
            </p>

            {publishError && (
              <p className="mt-3 px-3 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 rounded-lg">
                {publishError}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setPublishAddressOpen(false)}
                disabled={publishing}
                className="px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {labels.cancel}
              </button>
              <button
                onClick={handlePublish}
                disabled={
                  publishing ||
                  !publishAddressValue.trim() ||
                  (publishAddressValue !== page?.subdomain && subdomainAvailable === false)
                }
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-all disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {labels.publish}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Dialog (for services editing) */}
      <ConfigurationDialog
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        initialTab="services"
        visibleTabs={['services']}
      />

      {/* Add Section Modal */}
      {showAddSectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddSectionModal(false)} />
          {/*
            Scrolls the way every other dialog in the platform scrolls.

            This one scrolled its WHOLE body — header included — and pinned the
            header back with `position: sticky`. Two things followed from that,
            both visible: a sticky element with no z-index creates no stacking
            context, so the tiles below it in the DOM painted straight over it
            and the solid header looked transparent while scrolling; and the
            scrollbar ran the full height of the dialog rather than the height
            of the list, which is what made it feel unlike the others.

            The platform pattern — `overflow-hidden` on the shell, a column
            layout, and `flex-1 overflow-auto` on the body alone — is what the
            landing-page wizard and the configuration dialog already use. The
            header simply does not move, so it needs neither sticky nor a
            stacking context.
          */}
          <div
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] w-full max-w-2xl max-h-[calc(100ddvh-2rem)] sm:max-h-[80dvh] overflow-hidden flex flex-col mx-4"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="shrink-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] p-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                {language === 'he' ? 'הוסף חלק חדש' : language === 'es' ? 'Agregar Nueva Sección' : 'Add New Section'}
              </h3>
              <button
                onClick={() => setShowAddSectionModal(false)}
                className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-sm text-[var(--v2-text-muted)] mb-4">
                {language === 'he' ? 'בחר סוג חלק להוספה לאתר שלך' : language === 'es' ? 'Selecciona el tipo de sección para agregar a tu sitio' : 'Choose a section type to add to your website'}
              </p>

              {/* One column on a phone: two 150px tiles each holding an icon,
                  a name and a description is narrower than the words in them. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { type: 'hero', icon: Target, label: { en: 'Hero', es: 'Encabezado', he: 'כותרת ראשית' }, desc: { en: 'Main headline section', es: 'Sección principal', he: 'חלק כותרת ראשי' } },
                  { type: 'services', icon: Package, label: { en: 'Services', es: 'Servicios', he: 'שירותים' }, desc: { en: 'List your services', es: 'Lista de servicios', he: 'רשימת השירותים' } },
                  { type: 'about', icon: User, label: { en: 'About', es: 'Acerca de', he: 'אודות' }, desc: { en: 'About you/company', es: 'Sobre ti/empresa', he: 'על העסק' } },
                  { type: 'cta', icon: Megaphone, label: { en: 'Call to Action', es: 'Llamada a Acción', he: 'קריאה לפעולה' }, desc: { en: 'Action prompt', es: 'Invitación a actuar', he: 'הנעה לפעולה' } },
                  { type: 'testimonials', icon: MessageCircle, label: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' }, desc: { en: 'Client reviews', es: 'Reseñas de clientes', he: 'חוות דעת' } },
                  { type: 'faq', icon: HelpCircle, label: { en: 'FAQ', es: 'Preguntas', he: 'שאלות נפוצות' }, desc: { en: 'Common questions', es: 'Preguntas frecuentes', he: 'שאלות ותשובות' } },
                  /*
                   * Pricing is withheld too, and for a different reason from
                   * Booking and Intake above: it is not unconfigured, it is
                   * duplicated. The services section on this same page already
                   * lists every service with its price, its duration and a hide
                   * toggle. Pricing belongs to landing pages, where there is no
                   * services section and it is the only place the offer's price
                   * and booking button appear.
                   */
                  { type: 'features', icon: Sparkles, label: { en: 'Features', es: 'Características', he: 'תכונות' }, desc: { en: 'Key features', es: 'Características clave', he: 'יתרונות' } },
                  { type: 'team', icon: Users, label: { en: 'Team', es: 'Equipo', he: 'צוות' }, desc: { en: 'Team members', es: 'Miembros del equipo', he: 'חברי הצוות' } },
                  { type: 'stats', icon: BarChart3, label: { en: 'Stats', es: 'Estadísticas', he: 'סטטיסטיקות' }, desc: { en: 'Key metrics', es: 'Métricas clave', he: 'נתונים' } },
                  { type: 'gallery', icon: ImageIcon, label: { en: 'Gallery', es: 'Galería', he: 'גלריה' }, desc: { en: 'Image gallery', es: 'Galería de imágenes', he: 'גלריית תמונות' } },
                  { type: 'video', icon: Video, label: { en: 'Video', es: 'Video', he: 'וידאו' }, desc: { en: 'Embedded video', es: 'Video incrustado', he: 'סרטון' } },
                  { type: 'contact_form', icon: Mail, label: { en: 'Contact Form', es: 'Formulario', he: 'טופס יצירת קשר' }, desc: { en: 'Contact form', es: 'Formulario de contacto', he: 'טופס פנייה' } },
                  /*
                   * Booking, Intake and Payment are withheld from this picker.
                   *
                   * Not deleted: pages already carrying one keep rendering it,
                   * the editor still edits it, and `getDefaultBlockContent`
                   * still knows their shapes. Only the way to ADD a new one is
                   * closed, because each of the three depends on configuration
                   * this dialog cannot see — a bookable service with
                   * availability, an intake form that exists, a connected
                   * processor — and dropped onto a page without it, they render
                   * as a dead control on the owner's live site.
                   *
                   * Restore a row here once the picker can check that gate and
                   * say so, rather than letting the section fail quietly.
                   */
                  { type: 'newsletter', icon: Newspaper, label: { en: 'Newsletter', es: 'Boletín', he: 'ניוזלטר' }, desc: { en: 'Email signup', es: 'Suscripción', he: 'הרשמה לעדכונים' } },
                  { type: 'logo_cloud', icon: Briefcase, label: { en: 'Logo Cloud', es: 'Logos', he: 'לוגואים' }, desc: { en: 'Partner logos', es: 'Logos de socios', he: 'לוגואים של שותפים' } },
                ].map(({ type, icon: Icon, label, desc }) => {
                  /*
                   * A SECTION THE PAGE ALREADY HAS CANNOT BE ADDED AGAIN.
                   *
                   * Not merely tidiness. Menu navigation resolves an anchor per
                   * BLOCK TYPE — `getAnchorId(block.block_type)` in
                   * blocks/index.tsx — so a second Services section gives the
                   * page two elements with id="services". That is invalid HTML,
                   * and `document.querySelector` answers with the first one, so
                   * the menu link silently stops reaching whichever the owner
                   * meant. The duplicate also arrives empty, beneath a section
                   * of the same name that is full, which reads as the editor
                   * having lost the content.
                   *
                   * Shown as taken rather than hidden: an owner looking for
                   * Testimonials needs to find out it is already on the page,
                   * not conclude the platform does not offer it.
                   */
                  const alreadyOnPage = blocks.some(b => b.block_type === type);

                  return (
                  <button
                    key={type}
                    onClick={() => handleAddSection(type)}
                    disabled={addingSection || alreadyOnPage}
                    title={
                      alreadyOnPage
                        ? (language === 'he' ? 'החלק הזה כבר קיים בעמוד' : language === 'es' ? 'Esta sección ya está en la página' : 'This section is already on the page')
                        : undefined
                    }
                    className={`relative flex flex-col items-center gap-2 p-4 border rounded-lg transition-all ${
                      alreadyOnPage
                        ? 'border-[var(--v2-border)] opacity-55 cursor-not-allowed'
                        : 'border-[var(--v2-border)] hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 disabled:opacity-50'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${alreadyOnPage ? 'bg-[var(--v2-surface-2)]' : 'bg-[#4F6EF7]/10'}`}>
                      <Icon className={`w-5 h-5 ${alreadyOnPage ? 'text-[var(--v2-text-muted)]' : 'text-[#4F6EF7]'}`} />
                    </div>
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {label[language] || label.en}
                    </span>
                    <span className="text-xs text-[var(--v2-text-muted)] text-center">
                      {alreadyOnPage
                        ? (language === 'he' ? 'כבר בעמוד' : language === 'es' ? 'Ya en la página' : 'Already added')
                        : (desc[language] || desc.en)}
                    </span>
                    {alreadyOnPage && (
                      <Check className="absolute top-2 end-2 w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                    )}
                  </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Acquisition Wizard (Smart Links + Landing Pages) */}
      {showLandingPageWizard && (
        <LandingPageWizard
          templates={templates}
          {...(() => {
            /*
             * The BUSINESS's look, not the open page's.
             *
             * This read `page.theme`, so with no website open there was no
             * existing theme to offer and the wizard made the business pick a
             * style of its own — a second look, on an account that already had
             * one in `business_profiles.theme`, which is what the invoices and
             * emails already wear. The page theme stays as the fallback for
             * accounts whose look predates that column.
             */
            // Cast because `BusinessProfile` is `Database[...]['Row']` and
            // `types/database.ts` does not exist in this repo, so the generated
            // row type knows none of its columns. The column is real — it is
            // what `lib/email/branding.ts` reads for every invoice and receipt.
            const businessLook = (businessProfile as unknown as { theme?: { colors?: Record<string, string>; fonts?: Record<string, string> } } | null)?.theme;
            const look = businessLook || page?.theme;
            return {
              existingTheme: look ? {
                colors: {
                  primary: look.colors?.primary || '#4F6EF7',
                  secondary: look.colors?.secondary || '#6366F1'
                },
                fonts: {
                  heading: look.fonts?.heading || 'Inter',
                  body: look.fonts?.body || 'Inter'
                }
              } : null
            };
          })()}
          subdomain={page?.subdomain || ''}
          businessInfo={{
            companyName: businessProfile?.company_name,
            // The business's own logo, so the wizard can offer to show it.
            logoUrl: businessProfile?.logo_url as string | undefined
          }}
          clientFlow={clientFlow}
          userCode={businessProfile?.user_code || ''}
          onComplete={async (result: LandingPageWizardResult) => {
            setShowLandingPageWizard(false);
            setEditingSmartLink(null);

            // Handle Smart Link completion - no additional API call needed
            // (the smart link was already created in the wizard)
            if (result.creationType === 'smart-link') {
              logger.info({
                smartLinkCode: result.smartLink?.code,
                journeyType: result.journeyType
              }, 'Smart link created successfully');
              // Trigger refresh of smart links list
              setSmartLinksRefreshTrigger(prev => prev + 1);
              return;
            }

            /*
             * Say that something is happening.
             *
             * The dialog closes the instant this handler starts, and the
             * request behind it takes as long as it takes — it writes the page
             * and its blocks, and now fetches four photographs. Until this
             * notice existed, that whole window looked identical to the wizard
             * having thrown the work away: no dialog, no row, no message.
             */
            setGenerationNotice({ kind: 'progress', message: labels.landing_page_creating });

            // Handle Landing Page creation
            setCreatingPage(true);
            try {
              logger.info({
                serviceId: result.serviceId,
                slug: result.slug,
                hasGeneratedContent: !!result.generatedContent,
                contentKeys: result.generatedContent ? Object.keys(result.generatedContent) : []
              }, 'Creating landing page');

              const response = await fetch('/api/website/landing-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  serviceId: result.serviceId,
                  serviceName: result.serviceName,
                  slug: result.slug,
                  theme: result.theme,
                  // What the page was built from. Without it a landing page
                  // could give the business a look but never a template.
                  templateId: result.templateId,
                  shouldPublish: result.shouldPublish,
                  clientFlow: result.clientFlow,
                  generatedContent: result.generatedContent,
                  // Pass website language for localized content
                  language: language,
                  // Whether this landing page's header wears the business logo
                  showLogo: result.showLogo,
                  companyName: businessProfile?.company_name
                })
              });

              const data = await response.json();
              logger.info({ success: data.success, error: data.error, landingPageId: data.landingPage?.id }, 'Landing page API response');

              if (data.success) {
                /*
                 * Back to the list, not into the page.
                 *
                 * This pushed `?pageId=<new id>`, which opens the new landing
                 * page in the editor — so finishing the wizard dropped the
                 * person straight into editing the thing they had just
                 * finished describing, with no sight of where it went. Whether
                 * they saved a draft or published, the answer to "what did I
                 * just make?" is the list they made it from.
                 *
                 * Refreshing `allPages` is all it takes: the list below renders
                 * `allPages.filter(page_type === 'landing')`, and the wizard was
                 * opened from beside it.
                 */
                /*
                 * The row appears from the answer we already have.
                 *
                 * This used to depend entirely on a SECOND request, whose
                 * failure was swallowed by a bare `if (pagesData.success)` with
                 * no else — so a page that was created perfectly well could
                 * leave the list exactly as it was, with the dialog gone and
                 * nothing to say anything had happened. Saving a draft looked
                 * like saving nothing.
                 *
                 * The created page is in `data.landingPage`. Using it puts the
                 * row on screen the moment the server answers, and makes the
                 * refetch below a reconciliation rather than the only hope.
                 */
                setGenerationNotice(null);

                if (data.landingPage) {
                  setAllPages(prev =>
                    prev.some(item => item.id === data.landingPage.id)
                      ? prev.map(item => (item.id === data.landingPage.id ? data.landingPage : item))
                      : [data.landingPage, ...prev]
                  );
                }

                // Reconciliation: ordering, and anything the server changed on
                // the way in. It must never be able to empty a list it failed
                // to read — hence the explicit failure branch this lacked.
                try {
                  const pagesResponse = await fetch('/api/website/pages');
                  const pagesData = await pagesResponse.json();
                  if (pagesData.success && Array.isArray(pagesData.pages)) {
                    setAllPages(pagesData.pages);
                  } else {
                    logger.warn({ error: pagesData.error }, 'Could not re-read the page list after creating a landing page');
                  }
                } catch (refreshError) {
                  logger.warn({ err: refreshError }, 'Could not re-read the page list after creating a landing page');
                }

                // This page may have just established the business template.
                await refreshBusinessTemplate();
              } else {
                logger.error({ error: data.error }, 'Failed to create landing page - API returned error');
                // Shown in the page rather than in a browser alert(), which
                // cannot be styled, cannot be translated, and blocks the tab.
                setGenerationNotice({
                  kind: 'error',
                  message: data.error || labels.landing_page_failed,
                });
              }
            } catch (error) {
              // The wizard has already closed by now, so a failure that only
              // reaches the console is indistinguishable from success: the
              // dialog disappears and the list is unchanged. Anything that
              // stops the request — a dropped connection, a restarting dev
              // server — has to say so on the page.
              logger.error({ err: error }, 'Failed to create landing page');
              setGenerationNotice({ kind: 'error', message: labels.landing_page_failed });
            } finally {
              setCreatingPage(false);
            }
          }}
          onCancel={() => {
            setShowLandingPageWizard(false);
            setEditingSmartLink(null);
          }}
          editingSmartLink={editingSmartLink}
        />
      )}

      {/* Deleting the whole website.
          Its own dialog rather than the page one above: this removes the copy
          as well, and it can take a live site offline — neither of which the
          landing-page wording says. */}
      <Dialog open={deleteWebsiteOpen} onOpenChange={setDeleteWebsiteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {labels.delete_website_confirm_title}
            </DialogTitle>
            <DialogDescription className="text-[var(--v2-text-secondary)]">
              {labels.delete_website_confirm_body}
            </DialogDescription>
          </DialogHeader>

          {/* Only for a site somebody can currently reach. */}
          {page?.published && (
            <p
              className="px-3 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.delete_website_confirm_live}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeleteWebsiteOpen(false)}
              disabled={deletingWebsite}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.cancel}
            </button>
            <button
              onClick={handleDeleteWebsite}
              disabled={deletingWebsite}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {deletingWebsite && <Loader2 className="w-4 h-4 animate-spin" />}
              {labels.delete_website_confirm_action}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Page Confirmation Dialog */}
      <Dialog open={!!publishLanding} onOpenChange={(open) => { if (!open) setPublishLanding(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-[#4F6EF7]" />
              {labels.publish_landing_title}
            </DialogTitle>
            <DialogDescription className="text-[var(--v2-text-secondary)]">
              {labels.publish_landing_url_hint}
            </DialogDescription>
          </DialogHeader>

          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
              {labels.publish_landing_url}
            </label>
            <div
              className="flex items-center gap-1 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] focus-within:ring-2 focus-within:ring-[#4F6EF7]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              dir="ltr"
            >
              {/* The prefix is editable while the business has no address of
                  its own; once a website has set one, every page shares it and
                  it is shown rather than asked for again. */}
              {publishLanding?.subdomain ? (
                <span className="text-sm text-[var(--v2-text-muted)] font-mono whitespace-nowrap">
                  {publishLanding.subdomain}.
                </span>
              ) : (
                <input
                  type="text"
                  value={publishSubdomainDraft}
                  onChange={(e) => setPublishSubdomainDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="yoursite"
                  className="w-28 min-w-0 bg-transparent text-sm font-mono text-[var(--v2-text-primary)] border-b border-[var(--v2-border)] focus:outline-none focus:border-[#4F6EF7]"
                />
              )}
              <span className="text-sm text-[var(--v2-text-muted)] font-mono whitespace-nowrap">
                {publishLanding?.subdomain ? 'agentspilot.com/' : '.agentspilot.com/'}
              </span>
              <input
                type="text"
                autoFocus
                value={publishSlugDraft}
                onChange={(e) => setPublishSlugDraft(e.target.value)}
                placeholder="my-page"
                className="flex-1 min-w-0 bg-transparent text-sm font-mono text-[var(--v2-text-primary)] focus:outline-none"
              />
            </div>
            {publishLandingError && (
              <p className="text-xs text-red-500 mt-2">{publishLandingError}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setPublishLanding(null)}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.cancel}
            </button>
            <button
              onClick={handlePublishLandingConfirm}
              disabled={publishLandingBusy || !publishSlugDraft.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4F6EF7] hover:bg-[#3D5BD9] disabled:opacity-50 transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {publishLandingBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              {labels.publish_landing}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {labels.delete_page_title}
            </DialogTitle>
            <DialogDescription className="text-[var(--v2-text-secondary)]">
              {deletingPage?.hasActivity
                ? `${labels.delete_page_has_activity.replace('{count}', String(deletingPage.viewCount))} ${labels.delete_page_deactivate}`
                : labels.delete_page_confirm}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeleteDialogOpen(false)}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.cancel}
            </button>
            <button
              onClick={handleConfirmDelete}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {labels.delete_confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Block Confirmation Dialog */}
      <Dialog open={deleteBlockModal.isOpen} onOpenChange={(open) => !deletingBlock && setDeleteBlockModal({ isOpen: open, blockId: null, blockType: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {language === 'he' ? 'מחיקת מקטע' : language === 'es' ? 'Eliminar Sección' : 'Delete Section'}
            </DialogTitle>
            <DialogDescription className="text-[var(--v2-text-secondary)]">
              {language === 'he'
                ? `האם אתה בטוח שברצונך למחוק את מקטע "${getBlockName(deleteBlockModal.blockType || '')}"? פעולה זו לא ניתנת לביטול.`
                : language === 'es'
                ? `¿Estás seguro de que quieres eliminar la sección "${getBlockName(deleteBlockModal.blockType || '')}"? Esta acción no se puede deshacer.`
                : `Are you sure you want to delete the "${getBlockName(deleteBlockModal.blockType || '')}" section? This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeleteBlockModal({ isOpen: false, blockId: null, blockType: null })}
              disabled={deletingBlock}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {language === 'he' ? 'ביטול' : language === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={handleDeleteBlock}
              disabled={deletingBlock}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {deletingBlock && <Loader2 className="w-4 h-4 animate-spin" />}
              {language === 'he' ? 'מחק' : language === 'es' ? 'Eliminar' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Smart Link Confirmation Dialog */}
      <Dialog open={deleteSmartLinkDialogOpen} onOpenChange={setDeleteSmartLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {language === 'he' ? 'מחיקת קישור חכם' : language === 'es' ? 'Eliminar Smart Link' : 'Delete Smart Link'}
            </DialogTitle>
            <DialogDescription className="text-[var(--v2-text-secondary)]">
              {/* Says what is actually lost. The delete is permanent and takes
                  the link's click history and attributed revenue with it — the
                  copy said "cannot be undone" back when it only deactivated,
                  which was both untrue and understated. Deactivating instead
                  keeps everything. */}
              {language === 'he'
                ? `למחוק את "${deletingSmartLink?.name}" לצמיתות? הקישור יפסיק לעבוד, והקליקים וההכנסות שנרשמו לו יימחקו איתו. כדי רק להשבית אותו ולשמור את הנתונים — השתמשו ב"השבתה".`
                : language === 'es'
                ? `¿Eliminar "${deletingSmartLink?.name}" definitivamente? El enlace dejará de funcionar y sus clics e ingresos atribuidos se eliminarán con él. Para solo apagarlo y conservar los datos, usa "Desactivar".`
                : `Delete "${deletingSmartLink?.name}" permanently? The link stops working, and its clicks and attributed revenue are deleted with it. To just switch it off and keep the data, use Deactivate.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setDeleteSmartLinkDialogOpen(false)}
              disabled={deletingSmartLinkLoading}
              className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-border)] transition-colors disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {language === 'he' ? 'ביטול' : language === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={async () => {
                if (!deletingSmartLink) return;
                setDeletingSmartLinkLoading(true);
                try {
                  const response = await fetch(`/api/smart-links/${deletingSmartLink.id}`, { method: 'DELETE' });
                  if (response.ok) {
                    // Gone, so it leaves the list. It used to be marked
                    // inactive here, which is what Deactivate is for — the row
                    // stayed on screen and the person had just pressed Delete.
                    setSmartLinks(prev => prev.filter(l => l.id !== deletingSmartLink.id));
                    setSmartLinkNotice(null);
                    setDeleteSmartLinkDialogOpen(false);
                    setDeletingSmartLink(null);
                  }
                } catch (err) {
                  logger.error({ err }, 'Failed to delete smart link');
                } finally {
                  setDeletingSmartLinkLoading(false);
                }
              }}
              disabled={deletingSmartLinkLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {deletingSmartLinkLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {language === 'he' ? 'מחק' : language === 'es' ? 'Eliminar' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
