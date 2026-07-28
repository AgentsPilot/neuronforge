'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { Globe, Layout, Settings, Eye, EyeOff, ArrowLeft, Palette, ExternalLink, Copy, Check, Loader2, Rocket, PenLine, LayoutTemplate, RefreshCw, Plus, FileText, Trash2, X, Target, List, Megaphone, MessageCircle, Mail, DollarSign, HelpCircle, User, Sparkles, Calendar, CreditCard, Users, RotateCcw, Image as ImageIcon, Newspaper, Video, BarChart3, Package, ChevronDown, ChevronUp, Save, Wand2, Link2, Brain, Dumbbell, Hand, Flower2, Camera, Scale, Code, BookOpen, Music, Scissors, Heart, Briefcase, GraduationCap, Stethoscope, Calculator, PenTool, Mic, Utensils, Wrench, Car, Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, TrendingUp, ShoppingCart, Apple, Star, Building, type LucideIcon } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WebsitePage, PageTheme } from '@/lib/repositories/WebsitePageRepository';
import type { WebsiteBlock } from '@/lib/repositories/WebsiteBlockRepository';
import { TestimonialEditor } from '@/components/website/TestimonialEditor';
import type { TestimonialItem, ProcessStep } from '@/components/website/blocks/types';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
import { MediaUploader } from '@/components/website/MediaUploader';

const logger = createLogger({ module: 'WebsitePage' });

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

// Website theme color: Blue (matching CRM's purple pattern)
const WEBSITE_COLOR = '#4F6EF7';

type ViewMode = 'overview' | 'pages' | 'sections' | 'design' | 'settings' | 'templates';

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

interface BusinessProfile {
  id: string;
  user_id: string;
  company_name: string | null;
  vertical: string;
  sub_vertical: string | null;
}

// Localized strings
const LABELS = {
  en: {
    back_to_dashboard: 'Back to Dashboard',
    title: 'Website',
    subtitle: 'Manage your professional website',
    tab_overview: 'Overview',
    tab_sections: 'Sections',
    tab_design: 'Design',
    tab_settings: 'Settings',
    tab_templates: 'Templates',
    status_draft: 'Draft',
    status_live: 'Live',
    status_coming_soon: 'Coming Soon',
    publish: 'Publish',
    unpublish: 'Unpublish',
    publishing: 'Publishing...',
    view_site: 'View Site',
    copy_link: 'Copy Link',
    link_copied: 'Link Copied!',
    no_website: 'No Website Yet',
    no_website_desc: 'Choose a template to create your professional website.',
    choose_template: 'Choose a Template',
    loading: 'Loading...',
    preview: 'Preview',
    edit_content: 'Edit Content',
    subdomain: 'Subdomain',
    subdomain_desc: 'Your website will be available at',
    subdomain_taken: 'This subdomain is already taken',
    subdomain_available: 'Available',
    save_changes: 'Save Changes',
    saving: 'Saving...',
    sections_title: 'Website Sections',
    sections_desc: 'Toggle sections on/off and drag to reorder',
    design_title: 'Design & Theme',
    design_desc: 'Customize colors, fonts, and styling',
    settings_title: 'Website Settings',
    settings_desc: 'Configure subdomain and SEO settings',
    visitors_today: 'Visitors Today',
    visitors_month: 'This Month',
    page_views: 'Page Views',
    primary_color: 'Primary Color',
    font_heading: 'Heading Font',
    font_body: 'Body Font',
    meta_title: 'Page Title',
    meta_description: 'Meta Description',
    seo_keywords: 'SEO Keywords',
    templates_title: 'Change Template',
    templates_desc: 'Select a different template for your website. This will replace your current design.',
    current_template: 'Current Template',
    apply_template: 'Apply Template',
    applying_template: 'Applying...',
    template_warning: 'Applying a new template will replace your current design and blocks.',
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
    generated_from_business: 'Generated from business name'
  },
  es: {
    back_to_dashboard: 'Volver al Panel',
    title: 'Sitio Web',
    subtitle: 'Gestiona tu sitio web profesional',
    tab_overview: 'General',
    tab_sections: 'Secciones',
    tab_design: 'Diseño',
    tab_settings: 'Configuración',
    tab_templates: 'Plantillas',
    status_draft: 'Borrador',
    status_live: 'Publicado',
    status_coming_soon: 'Próximamente',
    publish: 'Publicar',
    unpublish: 'Despublicar',
    publishing: 'Publicando...',
    view_site: 'Ver Sitio',
    copy_link: 'Copiar Enlace',
    link_copied: '¡Enlace Copiado!',
    no_website: 'Sin Sitio Web',
    no_website_desc: 'Elige una plantilla para crear tu sitio web profesional.',
    choose_template: 'Elegir Plantilla',
    loading: 'Cargando...',
    preview: 'Vista Previa',
    edit_content: 'Editar Contenido',
    subdomain: 'Subdominio',
    subdomain_desc: 'Tu sitio web estará disponible en',
    subdomain_taken: 'Este subdominio ya está ocupado',
    subdomain_available: 'Disponible',
    save_changes: 'Guardar Cambios',
    saving: 'Guardando...',
    sections_title: 'Secciones del Sitio',
    sections_desc: 'Activa/desactiva secciones y arrastra para reordenar',
    design_title: 'Diseño y Tema',
    design_desc: 'Personaliza colores, fuentes y estilo',
    settings_title: 'Configuración del Sitio',
    settings_desc: 'Configura subdominio y SEO',
    visitors_today: 'Visitantes Hoy',
    visitors_month: 'Este Mes',
    page_views: 'Visitas',
    primary_color: 'Color Principal',
    font_heading: 'Fuente de Títulos',
    font_body: 'Fuente de Texto',
    meta_title: 'Título de Página',
    meta_description: 'Meta Descripción',
    seo_keywords: 'Palabras Clave SEO',
    templates_title: 'Cambiar Plantilla',
    templates_desc: 'Selecciona una plantilla diferente para tu sitio web. Esto reemplazará tu diseño actual.',
    current_template: 'Plantilla Actual',
    apply_template: 'Aplicar Plantilla',
    applying_template: 'Aplicando...',
    template_warning: 'Aplicar una nueva plantilla reemplazará tu diseño y bloques actuales.',
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
    generated_from_business: 'Generado del nombre del negocio'
  },
  he: {
    back_to_dashboard: 'חזרה ללוח הבקרה',
    title: 'אתר אינטרנט',
    subtitle: 'נהל את האתר המקצועי שלך',
    tab_overview: 'סקירה',
    tab_sections: 'חלקים',
    tab_design: 'עיצוב',
    tab_settings: 'הגדרות',
    tab_templates: 'תבניות',
    status_draft: 'טיוטה',
    status_live: 'פעיל',
    status_coming_soon: 'בקרוב',
    publish: 'פרסם',
    unpublish: 'הסר מפרסום',
    publishing: '...מפרסם',
    view_site: 'צפה באתר',
    copy_link: 'העתק קישור',
    link_copied: '!קישור הועתק',
    no_website: 'עדיין אין אתר',
    no_website_desc: 'בחר תבנית ליצירת האתר המקצועי שלך.',
    choose_template: 'בחר תבנית',
    loading: '...טוען',
    preview: 'תצוגה מקדימה',
    edit_content: 'ערוך תוכן',
    subdomain: 'תת-דומיין',
    subdomain_desc: 'האתר שלך יהיה זמין ב',
    subdomain_taken: 'תת-דומיין זה כבר תפוס',
    subdomain_available: 'זמין',
    save_changes: 'שמור שינויים',
    saving: '...שומר',
    sections_title: 'חלקי האתר',
    sections_desc: 'הפעל/כבה חלקים וגרור לסידור מחדש',
    design_title: 'עיצוב ותבנית',
    design_desc: 'התאם אישית צבעים, גופנים ועיצוב',
    settings_title: 'הגדרות האתר',
    settings_desc: 'הגדר תת-דומיין ו-SEO',
    visitors_today: 'מבקרים היום',
    visitors_month: 'החודש',
    page_views: 'צפיות',
    primary_color: 'צבע ראשי',
    font_heading: 'גופן כותרות',
    font_body: 'גופן גוף',
    meta_title: 'כותרת עמוד',
    meta_description: 'תיאור מטא',
    seo_keywords: 'מילות מפתח SEO',
    templates_title: 'החלף תבנית',
    templates_desc: 'בחר תבנית אחרת לאתר שלך. זה יחליף את העיצוב הנוכחי.',
    current_template: 'תבנית נוכחית',
    apply_template: 'החל תבנית',
    applying_template: '...מחיל',
    template_warning: 'החלת תבנית חדשה תחליף את העיצוב והבלוקים הנוכחיים.',
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
    generated_from_business: 'נוצר משם העסק'
  }
};

// Template name translations
const TEMPLATE_NAMES: Record<string, { en: string; es: string; he: string }> = {
  // Therapist
  'Warm & Welcoming': { en: 'Warm & Welcoming', es: 'Cálido y Acogedor', he: 'חם ומזמין' },
  'Professional & Clinical': { en: 'Professional & Clinical', es: 'Profesional y Clínico', he: 'מקצועי וקליני' },
  'Modern & Minimal': { en: 'Modern & Minimal', es: 'Moderno y Minimalista', he: 'מודרני ומינימליסטי' },
  'Specialized (Trauma-Focused)': { en: 'Specialized (Trauma-Focused)', es: 'Especializado (Trauma)', he: 'מתמחה (טראומה)' },
  // Coach
  'Inspiring Transformation': { en: 'Inspiring Transformation', es: 'Transformación Inspiradora', he: 'טרנספורמציה מעוררת השראה' },
  'Professional Executive': { en: 'Professional Executive', es: 'Ejecutivo Profesional', he: 'מנהל מקצועי' },
  'Wellness & Mindfulness': { en: 'Wellness & Mindfulness', es: 'Bienestar y Mindfulness', he: 'בריאות ומיינדפולנס' },
  'Career Transition': { en: 'Career Transition', es: 'Transición de Carrera', he: 'מעבר קריירה' },
  // Consultant
  'Professional Services': { en: 'Professional Services', es: 'Servicios Profesionales', he: 'שירותים מקצועיים' },
  'Technology Advisory': { en: 'Technology Advisory', es: 'Asesoría Tecnológica', he: 'ייעוץ טכנולוגי' },
  'Marketing Consultant': { en: 'Marketing Consultant', es: 'Consultor de Marketing', he: 'יועץ שיווק' },
  'Financial Advisory': { en: 'Financial Advisory', es: 'Asesoría Financiera', he: 'ייעוץ פיננסי' },
  // Lawyer
  'Professional Law Firm': { en: 'Professional Law Firm', es: 'Firma de Abogados', he: 'משרד עורכי דין' },
  'Personal Injury Specialist': { en: 'Personal Injury Specialist', es: 'Especialista en Lesiones', he: 'מומחה נזקי גוף' },
  'Family Law Practice': { en: 'Family Law Practice', es: 'Derecho de Familia', he: 'דיני משפחה' },
  'Criminal Defense': { en: 'Criminal Defense', es: 'Defensa Penal', he: 'סנגוריה פלילית' },
  // Photographer
  'Minimal Portfolio': { en: 'Minimal Portfolio', es: 'Portafolio Minimalista', he: 'תיק עבודות מינימליסטי' },
  'Wedding Photography': { en: 'Wedding Photography', es: 'Fotografía de Bodas', he: 'צילום חתונות' },
  'Commercial Photography': { en: 'Commercial Photography', es: 'Fotografía Comercial', he: 'צילום מסחרי' },
  'Portrait Photography': { en: 'Portrait Photography', es: 'Fotografía de Retratos', he: 'צילום פורטרטים' },
  // Real Estate
  'Luxury Real Estate': { en: 'Luxury Real Estate', es: 'Bienes Raíces de Lujo', he: 'נדל"ן יוקרתי' },
  'Family Homes Specialist': { en: 'Family Homes Specialist', es: 'Especialista en Hogares', he: 'מומחה בתי משפחה' },
  'Commercial Real Estate': { en: 'Commercial Real Estate', es: 'Bienes Raíces Comerciales', he: 'נדל"ן מסחרי' },
  'First-Time Buyer Expert': { en: 'First-Time Buyer Expert', es: 'Experto en Primeros Compradores', he: 'מומחה רוכשים ראשונים' },
  // Personal Trainer
  'Gym Fitness Pro': { en: 'Gym Fitness Pro', es: 'Profesional del Fitness', he: 'מאמן כושר מקצועי' },
  'Wellness Coach': { en: 'Wellness Coach', es: 'Coach de Bienestar', he: 'מאמן בריאות' },
  'Sports Performance': { en: 'Sports Performance', es: 'Rendimiento Deportivo', he: 'ביצועי ספורט' },
  // Tutor
  'Academic Tutor': { en: 'Academic Tutor', es: 'Tutor Académico', he: 'מורה פרטי' },
  'Test Prep Expert': { en: 'Test Prep Expert', es: 'Experto en Preparación', he: 'מומחה הכנה למבחנים' },
  'Language Tutor': { en: 'Language Tutor', es: 'Tutor de Idiomas', he: 'מורה לשפות' }
};

// Vertical translations
const VERTICAL_NAMES: Record<string, { en: string; es: string; he: string }> = {
  therapist: { en: 'Therapist', es: 'Terapeuta', he: 'מטפל' },
  coach: { en: 'Coach', es: 'Coach', he: 'מאמן' },
  consultant: { en: 'Consultant', es: 'Consultor', he: 'יועץ' },
  lawyer: { en: 'Lawyer', es: 'Abogado', he: 'עורך דין' },
  photographer: { en: 'Photographer', es: 'Fotógrafo', he: 'צלם' },
  real_estate: { en: 'Real Estate', es: 'Bienes Raíces', he: 'נדל"ן' },
  personal_trainer: { en: 'Personal Trainer', es: 'Entrenador Personal', he: 'מאמן אישי' },
  tutor: { en: 'Tutor', es: 'Tutor', he: 'מורה פרטי' }
};

// Helper function to get translated template name
const getTranslatedTemplateName = (name: string, lang: 'en' | 'es' | 'he'): string => {
  return TEMPLATE_NAMES[name]?.[lang] || name;
};

// Helper function to get translated vertical name
const getTranslatedVertical = (vertical: string, lang: 'en' | 'es' | 'he'): string => {
  return VERTICAL_NAMES[vertical]?.[lang] || vertical;
};

export default function WebsiteManagementPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const { user } = useAuth();
  const labels = LABELS[language] || LABELS.en;

  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [page, setPage] = useState<WebsitePage | null>(null);
  const [allPages, setAllPages] = useState<WebsitePage[]>([]);
  const [blocks, setBlocks] = useState<WebsiteBlock[]>([]);
  const [templates, setTemplates] = useState<WebsiteTemplate[]>([]);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [showCreatePageModal, setShowCreatePageModal] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
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
  const [enrichmentSummary, setEnrichmentSummary] = useState<{
    has_services: boolean;
    service_count: number;
    has_profile: boolean;
    has_clients: boolean;
    client_count: number;
  } | null>(null);

  // AI generation state
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);

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

  // Configuration dialog state (for services editing)
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Add Section modal state
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [addingSection, setAddingSection] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // First fetch profile to get vertical for template filtering
      const profileResponse = await fetch('/api/business-os/profile');
      const profileData = await profileResponse.json();

      let profile: BusinessProfile | null = null;
      if (profileData.success && profileData.profile) {
        profile = profileData.profile;
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

      // Fetch pages and templates (filtered by vertical if profile exists)
      const templatesUrl = profile?.vertical
        ? `/api/website/templates?vertical=${encodeURIComponent(profile.vertical)}`
        : '/api/website/templates';

      const [pagesResponse, templatesResponse] = await Promise.all([
        fetch('/api/website/pages'),
        fetch(templatesUrl)
      ]);

      const [pagesData, templatesData] = await Promise.all([
        pagesResponse.json(),
        templatesResponse.json()
      ]);

      if (pagesData.success && pagesData.pages?.length > 0) {
        // Store all pages
        setAllPages(pagesData.pages);

        // Get the homepage (first page)
        const homepage = pagesData.pages.find((p: WebsitePage) => p.page_type === 'homepage') || pagesData.pages[0];
        setPage(homepage);
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
        const blocksResponse = await fetch(`/api/website/pages/${homepage.id}/blocks-with-content`);
        const blocksData = await blocksResponse.json();
        if (blocksData.success) {
          setBlocks(blocksData.blocks || []);
        }
      }

      if (templatesData.success) {
        setTemplates(templatesData.templates || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch website data');
    } finally {
      setLoading(false);
    }
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

  const handleDeletePage = async (pageId: string) => {
    try {
      const response = await fetch(`/api/website/pages/${pageId}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (data.success) {
        setAllPages(prev => prev.filter(p => p.id !== pageId));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete page');
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
        setBlocks(blocksData.blocks || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch blocks for page');
    }

    setViewMode('overview');
  };

  const handlePublish = async () => {
    if (!page) return;

    try {
      setPublishing(true);
      const response = await fetch(`/api/website/pages/${page.id}/publish`, {
        method: 'POST'
      });
      const data = await response.json();

      if (data.success) {
        setPage({ ...page, status: 'live', published: true });
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish website');
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
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to unpublish website');
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

  const handleToggleBlock = async (blockId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/website/pages/${page?.id}/blocks/${blockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (response.ok) {
        setBlocks(blocks.map(b => b.id === blockId ? { ...b, enabled } : b));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to toggle block');
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
          console.error('Failed to fetch services:', error);
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
      console.error('Failed to refresh services:', error);
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

  // Block types that should save directly to the block (page-specific, not shared)
  const SAVE_DIRECTLY_TO_BLOCK = ['services', 'header'];

  const handleSaveBlockContent = async (blockId: string) => {
    if (!editingBlockContent) return;

    try {
      setSavingBlock(true);

      // Find the block to get its type
      const block = blocks.find(b => b.id === blockId);
      if (!block) return;

      const sectionName = BLOCK_TO_SECTION[block.block_type];

      // Certain blocks save directly to block content (page-specific, not shared):
      // - services: includes hidden flags from Scheduling
      // - header: logo/menu is specific to each page
      // Other sections: Save to central content store (persists across templates)
      if (SAVE_DIRECTLY_TO_BLOCK.includes(block.block_type)) {
        // Save directly to block content
        const response = await fetch(`/api/website/pages/${page?.id}/blocks/${blockId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editingBlockContent })
        });

        if (!response.ok) {
          throw new Error(`Failed to save ${block.block_type}`);
        }
      } else {
        // Save to central content store (content persists across templates)
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
        setBlocks([...blocks, data.block]);
        setShowAddSectionModal(false);
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
      contact_form: { title: 'Contact Us', fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'email', type: 'email', label: 'Email', required: true }, { name: 'message', type: 'textarea', label: 'Message', required: true }] },
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

  // Generate content with AI for a specific field
  const handleGenerateWithAI = async (blockId: string, field: string, _prompt: string) => {
    setGeneratingAI(`${blockId}-${field}`);
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

  // Save design settings
  const handleSaveDesign = async () => {
    if (!page) return;

    try {
      setSavingDesign(true);
      setSaveMessage(null);

      const theme: PageTheme = {
        colors: {
          primary: designForm.primaryColor,
          secondary: designForm.secondaryColor,
          accent: page.theme?.colors?.accent || '#EC4899',
          background: page.theme?.colors?.background || '#FFFFFF',
          surface: page.theme?.colors?.surface || '#F9FAFB',
          text: page.theme?.colors?.text || '#111827',
          textSecondary: page.theme?.colors?.textSecondary || '#6B7280'
        },
        fonts: {
          heading: designForm.headingFont,
          body: designForm.bodyFont
        },
        borderRadius: page.theme?.borderRadius || '0.5rem',
        spacing: page.theme?.spacing || 'normal'
      };

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

  const handleApplyTemplate = async (templateId: string) => {
    if (!page) return;

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
        // Fetch updated blocks (with content from central store - content persists!)
        const blocksResponse = await fetch(`/api/website/pages/${page.id}/blocks-with-content`);
        const blocksData = await blocksResponse.json();
        if (blocksData.success) {
          setBlocks(blocksData.blocks || []);
        }
        setViewMode('overview');
      } else {
        logger.error({ error: data.error, details: data.details }, 'Failed to apply template');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to apply template');
    } finally {
      setApplyingTemplate(false);
    }
  };

  const getWebsiteUrl = () => {
    if (page?.subdomain) {
      return `https://${page.subdomain}.agentpilot.io`;
    }
    return null;
  };

  const getPreviewUrl = () => {
    if (page?.id) {
      return `/business-os/website/preview/${page.id}`;
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
      stats: { en: 'Statistics', es: 'Estadísticas', he: 'סטטיסטיקות' }
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

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">
      <BusinessOSHeader />

      {/* Main Content with max-width like CRM dashboard */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

        {/* Page Header with blue theme (Website capability color) - matching CRM pattern */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(79, 110, 247, 0.2)' }}
            >
              <Globe className="w-6 h-6" style={{ color: WEBSITE_COLOR }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
                {labels.title}
              </h1>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                {labels.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-2 text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={labels.back_to_dashboard}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            </button>

            {page && (
              <>
                {/* View Site Button */}
                {page.status === 'live' && page.subdomain && (
                  <a
                    href={getWebsiteUrl() || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {labels.view_site}
                  </a>
                )}

                {/* Copy Link Button */}
                {page.subdomain && (
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-2 px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    title={labels.copy_link}
                  >
                    {linkCopied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}

                {/* View Mode Tabs - matching CRM pattern */}
                <div
                  className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-1 inline-flex gap-1"
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  {[
                    { id: 'overview', icon: Eye, title: labels.tab_overview },
                    { id: 'pages', icon: FileText, title: labels.tab_pages },
                    { id: 'sections', icon: Layout, title: labels.tab_sections },
                    { id: 'design', icon: Palette, title: labels.tab_design },
                    { id: 'settings', icon: Settings, title: labels.tab_settings },
                    { id: 'templates', icon: LayoutTemplate, title: labels.tab_templates }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      className={`p-2 transition-all border ${
                        viewMode === tab.id
                          ? 'text-[#4F6EF7] border-[#4F6EF7] bg-[#4F6EF7]/10'
                          : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      onClick={() => setViewMode(tab.id as ViewMode)}
                      title={tab.title}
                    >
                      <tab.icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>

                {/* Publish/Unpublish Button - matching CRM's Add Contact pattern */}
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
              </>
            )}

            {/* Create Website Button when no page exists */}
            {!loading && !page && (
              <button
                onClick={() => setViewMode('templates')}
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

        {/* No Website - Template Selection */}
        {!loading && !page && (
          <div className="text-center py-16">
            <div
              className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-6"
              style={{ backgroundColor: 'rgba(79, 110, 247, 0.1)' }}
            >
              <Globe className="w-10 h-10" style={{ color: WEBSITE_COLOR }} />
            </div>
            <h2 className="text-2xl font-bold text-[var(--v2-text-primary)] mb-2">
              {labels.no_website}
            </h2>
            <p className="text-[var(--v2-text-secondary)] mb-8 max-w-md mx-auto">
              {labels.no_website_desc}
            </p>

            {/* Template Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {templates.slice(0, 6).map((template) => {
                const primaryColor = getTemplatePrimaryColor(template);
                const secondaryColor = getTemplateSecondaryColor(template);
                const blockTypes = template.blocks?.slice(0, 5) || [];
                return (
                  <motion.button
                    key={template.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleCreateFromTemplate(template.id)}
                    className="group p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-start hover:border-[#4F6EF7] transition-all overflow-hidden"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    {/* Template Preview Mockup */}
                    <div
                      className="w-full h-40 rounded-lg mb-4 overflow-hidden relative"
                      style={{ backgroundColor: '#1a1a2e' }}
                    >
                      {/* Header mockup */}
                      <div
                        className="h-2 w-full"
                        style={{ backgroundColor: primaryColor }}
                      />
                      {/* Hero section mockup */}
                      <div
                        className="mx-3 mt-3 h-12 rounded-sm flex items-center justify-center"
                        style={{ backgroundColor: `${primaryColor}30` }}
                      >
                        <div className="w-16 h-1.5 rounded" style={{ backgroundColor: primaryColor }} />
                      </div>
                      {/* Content blocks mockup */}
                      <div className="px-3 mt-2 space-y-1.5">
                        {blockTypes.slice(1, 4).map((block, idx) => (
                          <div
                            key={idx}
                            className="h-4 rounded-sm flex items-center gap-1 px-1"
                            style={{ backgroundColor: idx % 2 === 0 ? '#2a2a3e' : `${secondaryColor}20` }}
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: idx % 2 === 0 ? secondaryColor : primaryColor }}
                            />
                            <div className="flex-1 h-1 rounded bg-gray-600" />
                          </div>
                        ))}
                      </div>
                      {/* Brand voice badge */}
                      {template.theme?.brand_voice && (
                        <div
                          className="absolute bottom-2 right-2 px-2 py-0.5 text-[8px] font-medium rounded capitalize"
                          style={{
                            backgroundColor: `${primaryColor}30`,
                            color: primaryColor
                          }}
                        >
                          {template.theme.brand_voice}
                        </div>
                      )}
                    </div>
                    {/* Template Info */}
                    <h3 className="font-semibold text-[var(--v2-text-primary)] mb-1">
                      {getTranslatedTemplateName(template.name, language)}
                    </h3>
                    <p className="text-xs text-[var(--v2-text-muted)] capitalize mb-2">
                      {getTranslatedVertical(template.vertical, language)}
                    </p>
                    {/* Block count indicator */}
                    <div className="flex items-center gap-1">
                      {blockTypes.slice(0, 4).map((block, idx) => {
                        const blockType = block.block_type || block.type || '';
                        const BlockIcon = getBlockIcon(blockType);
                        return (
                          <div
                            key={idx}
                            className="w-5 h-5 rounded flex items-center justify-center"
                            style={{ backgroundColor: `${primaryColor}15` }}
                            title={getBlockName(blockType)}
                          >
                            <BlockIcon className="w-3 h-3" style={{ color: primaryColor }} />
                          </div>
                        );
                      })}
                      {blockTypes.length > 4 && (
                        <span className="text-[10px] text-[var(--v2-text-muted)]">
                          +{blockTypes.length - 4}
                        </span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        {/* Website Management Content */}
        {!loading && page && (
          <>
            {/* Overview Tab */}
            {viewMode === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Site Info Card */}
                <div
                  className="lg:col-span-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {page.title || 'My Website'}
                    </h3>
                    {/* Status Badge */}
                    <span
                      className={`px-3 py-1 text-xs font-medium rounded-full ${
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
                      <Globe className="w-5 h-5 text-[var(--v2-text-muted)]" />
                      <span className="flex-1 text-[var(--v2-text-secondary)] text-sm font-mono">
                        {page.subdomain}.agentpilot.io
                      </span>
                      <button
                        onClick={copyLink}
                        className="p-2 hover:bg-[var(--v2-surface)] rounded transition-colors"
                      >
                        {linkCopied ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-[var(--v2-text-muted)]" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex gap-3">
                    <a
                      href={getPreviewUrl() || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 text-[#4F6EF7] text-sm font-medium border border-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <Eye className="h-4 w-4" />
                      {labels.preview}
                    </a>
                    <button
                      onClick={() => setViewMode('sections')}
                      className="flex items-center gap-2 px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <PenLine className="h-4 w-4" />
                      {labels.edit_content}
                    </button>
                  </div>
                </div>

                {/* Stats Card */}
                <div
                  className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <h3 className="text-sm font-medium text-[var(--v2-text-muted)] uppercase tracking-wider mb-4">
                    {labels.page_views}
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-3xl font-bold text-[var(--v2-text-primary)]">0</p>
                      <p className="text-sm text-[var(--v2-text-muted)]">{labels.visitors_today}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-[var(--v2-text-primary)]">0</p>
                      <p className="text-sm text-[var(--v2-text-muted)]">{labels.visitors_month}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sections Tab */}
            {viewMode === 'sections' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {labels.sections_title}
                    </h3>
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                      {labels.sections_desc}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-3">
                    {syncResult && (
                      <span className={`text-sm ${syncResult.count > 0 ? 'text-green-500' : 'text-[var(--v2-text-muted)]'}`}>
                        {syncResult.message}
                      </span>
                    )}
                    {/* Add Section Button */}
                    <button
                      onClick={() => setShowAddSectionModal(true)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <Plus className="w-4 h-4" />
                      {language === 'he' ? 'הוסף חלק' : language === 'es' ? 'Agregar Sección' : 'Add Section'}
                    </button>
                    {/* Sync Button */}
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
                  </div>
                </div>

                <div className="space-y-3">
                  {blocks
                    .sort((a, b) => a.position - b.position)
                    .map((block) => {
                      const isExpanded = expandedBlockId === block.id;
                      const BlockIcon = getBlockIcon(block.block_type);
                      return (
                        <div
                          key={block.id}
                          className={`rounded-lg border transition-all ${
                            block.enabled
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
                                  checked={block.enabled}
                                  onChange={(e) => handleToggleBlock(block.id, e.target.checked)}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
                              </label>
                            </div>
                          </div>

                          {/* Expanded Content Editor */}
                          {isExpanded && editingBlockContent && (
                            <div className="px-4 pb-4 pt-2 border-t border-[var(--v2-border)]">
                              <div className="space-y-4">
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
                                        value={(editingBlockContent.image as string) || ''}
                                        onChange={(url) => updateBlockField('image', url)}
                                        onRemove={() => updateBlockField('image', '')}
                                        placeholder={language === 'he' ? 'גרור תמונה או לחץ להעלאה' : language === 'es' ? 'Arrastra imagen o haz clic' : 'Drag image or click to upload'}
                                        previewClassName="w-full h-40"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
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
                                    <div>
                                      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                                        {language === 'he' ? 'לוגו (אופציונלי)' : language === 'es' ? 'Logo (opcional)' : 'Logo (optional)'}
                                      </label>
                                      <p className="text-xs text-[var(--v2-text-muted)] mb-2">
                                        {language === 'he' ? 'מומלץ: 200x60 פיקסלים, PNG או SVG' : language === 'es' ? 'Recomendado: 200x60 píxeles, PNG o SVG' : 'Recommended: 200x60 pixels, PNG or SVG'}
                                      </p>
                                      <MediaUploader
                                        value={(editingBlockContent.logo_url as string) || ''}
                                        onChange={(url) => updateBlockField('logo_url', url)}
                                        onRemove={() => updateBlockField('logo_url', '')}
                                        placeholder={language === 'he' ? 'גרור לוגו או לחץ להעלאה' : language === 'es' ? 'Arrastra logo o haz clic' : 'Drag logo or click to upload'}
                                        previewClassName="w-full h-20"
                                        className="max-w-xs"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
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
                                    <div className="grid grid-cols-2 gap-4">
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
                                                  <div className="flex items-center justify-between gap-2">
                                                    <h4 className={`font-medium truncate ${service.hidden ? 'text-[var(--v2-text-secondary)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                                                      {service.name}
                                                    </h4>
                                                    <div className="flex items-center gap-2">
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
                                                        className={`p-1.5 rounded-lg transition-all ${
                                                          service.hidden
                                                            ? 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                                                            : 'bg-[#4F6EF7]/10 text-[#4F6EF7] hover:bg-[#4F6EF7]/20'
                                                        }`}
                                                        title={service.hidden
                                                          ? (language === 'he' ? 'הצג באתר' : language === 'es' ? 'Mostrar en web' : 'Show on website')
                                                          : (language === 'he' ? 'הסתר מהאתר' : language === 'es' ? 'Ocultar de web' : 'Hide from website')
                                                        }
                                                      >
                                                        {service.hidden ? (
                                                          <EyeOff className="w-4 h-4" />
                                                        ) : (
                                                          <Eye className="w-4 h-4" />
                                                        )}
                                                      </button>
                                                    </div>
                                                  </div>
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

                                {/* Process Block - Simple Visual Pipeline */}
                                {block.block_type === 'process' && (
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

                                    {/* Simple Visual Pipeline */}
                                    <div className="mt-4 p-4 bg-gradient-to-br from-[#4F6EF7]/5 to-transparent rounded-xl border border-[#4F6EF7]/20">
                                      <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-4">
                                        {language === 'he' ? 'מה קורה אחרי שלקוח בוחר שירות?' : language === 'es' ? '¿Qué pasa después de elegir un servicio?' : 'What happens after a client picks a service?'}
                                      </p>

                                      {/* Pipeline Steps - Click to toggle */}
                                      <div className="space-y-2">
                                        {[
                                          { key: 'booking', icon: Calendar, label: { en: 'Book a time', he: 'קביעת תור', es: 'Reservar hora' }, color: '#14B8A6' },
                                          { key: 'payment', icon: CreditCard, label: { en: 'Pay online', he: 'תשלום אונליין', es: 'Pagar online' }, color: '#10B981' },
                                          { key: 'intake', icon: FileText, label: { en: 'Fill intake form', he: 'מילוי שאלון', es: 'Llenar formulario' }, color: '#8B5CF6' },
                                          { key: 'confirmation', icon: Mail, label: { en: 'Get confirmation email', he: 'קבלת אישור במייל', es: 'Recibir confirmación' }, color: '#F59E0B' },
                                        ].map((step, idx) => {
                                          const flow = (editingBlockContent.flow as string[]) || ['booking', 'confirmation'];
                                          const isActive = flow.includes(step.key);
                                          const StepIcon = step.icon;
                                          return (
                                            <button
                                              key={step.key}
                                              onClick={() => {
                                                if (step.key === 'confirmation') return; // Always keep confirmation
                                                const newFlow = isActive
                                                  ? flow.filter(f => f !== step.key)
                                                  : [...flow.filter(f => f !== 'confirmation'), step.key, 'confirmation'];
                                                updateBlockField('flow', newFlow);
                                              }}
                                              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                                                isActive
                                                  ? 'border-transparent shadow-sm'
                                                  : 'border-dashed border-gray-300 bg-white/50 hover:border-gray-400'
                                              }`}
                                              style={isActive ? { backgroundColor: `${step.color}15`, borderColor: step.color } : {}}
                                            >
                                              <div
                                                className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive ? 'text-white' : 'text-gray-400 bg-gray-100'}`}
                                                style={isActive ? { backgroundColor: step.color } : {}}
                                              >
                                                {isActive ? (
                                                  <span className="text-sm font-bold">{flow.indexOf(step.key) + 1}</span>
                                                ) : (
                                                  <StepIcon className="w-4 h-4" />
                                                )}
                                              </div>
                                              <span className={`text-sm font-medium ${isActive ? 'text-[var(--v2-text-primary)]' : 'text-gray-400'}`}>
                                                {step.label[language] || step.label.en}
                                              </span>
                                              {isActive && step.key !== 'confirmation' && (
                                                <Check className="w-4 h-4 ms-auto" style={{ color: step.color }} />
                                              )}
                                              {!isActive && step.key !== 'confirmation' && (
                                                <Plus className="w-4 h-4 ms-auto text-gray-300" />
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>

                                      <p className="text-xs text-[var(--v2-text-secondary)] mt-3">
                                        {language === 'he'
                                          ? 'לחץ להוסיף או להסיר שלבים מהתהליך'
                                          : language === 'es'
                                          ? 'Haz clic para agregar o quitar pasos'
                                          : 'Click to add or remove steps from your flow'}
                                      </p>
                                    </div>
                                  </>
                                )}

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
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {language === 'he' ? 'חבילות מחירים' : language === 'es' ? 'Planes de Precios' : 'Pricing Plans'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const plans = (editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>) || [];
                                            updateBlockField('plans', [...plans, { name: '', price: '', features: [], highlighted: false }]);
                                          }}
                                          className="text-xs px-2 py-1 text-[#4F6EF7] hover:bg-[#4F6EF7]/10 rounded-md transition-colors"
                                        >
                                          + {language === 'he' ? 'הוסף חבילה' : language === 'es' ? 'Agregar Plan' : 'Add Plan'}
                                        </button>
                                      </div>
                                      <div className="space-y-4">
                                        {((editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>) || []).map((plan, idx) => (
                                          <div key={idx} className={`p-4 border rounded-lg space-y-3 ${plan.highlighted ? 'bg-[#4F6EF7]/5 border-[#4F6EF7]' : 'bg-[var(--v2-bg)] border-[var(--v2-border)]'}`}>
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-3 flex-1">
                                                <input
                                                  type="text"
                                                  value={plan.name}
                                                  onChange={(e) => {
                                                    const plans = [...(editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>)];
                                                    plans[idx] = { ...plans[idx], name: e.target.value };
                                                    updateBlockField('plans', plans);
                                                  }}
                                                  placeholder={language === 'he' ? 'שם חבילה...' : language === 'es' ? 'Nombre del plan...' : 'Plan name...'}
                                                  className="flex-1 px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] font-medium"
                                                />
                                                <input
                                                  type="text"
                                                  value={plan.price}
                                                  onChange={(e) => {
                                                    const plans = [...(editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>)];
                                                    plans[idx] = { ...plans[idx], price: e.target.value };
                                                    updateBlockField('plans', plans);
                                                  }}
                                                  placeholder="$99/mo"
                                                  className="w-24 px-2 py-1 bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-right font-bold"
                                                />
                                              </div>
                                              <div className="flex items-center gap-2 ml-3">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const plans = [...(editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>)];
                                                    plans[idx] = { ...plans[idx], highlighted: !plans[idx].highlighted };
                                                    updateBlockField('plans', plans);
                                                  }}
                                                  className={`p-1 rounded ${plan.highlighted ? 'text-[#4F6EF7]' : 'text-[var(--v2-text-muted)]'}`}
                                                  title={language === 'he' ? 'הדגש חבילה זו' : language === 'es' ? 'Destacar plan' : 'Highlight plan'}
                                                >
                                                  <Star className="w-4 h-4" fill={plan.highlighted ? 'currentColor' : 'none'} />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const plans = [...(editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>)];
                                                    plans.splice(idx, 1);
                                                    updateBlockField('plans', plans);
                                                  }}
                                                  className="p-1 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded"
                                                >
                                                  <Trash2 className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </div>
                                            <div>
                                              <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs text-[var(--v2-text-muted)]">
                                                  {language === 'he' ? 'תכונות (אחת בכל שורה)' : language === 'es' ? 'Características (una por línea)' : 'Features (one per line)'}
                                                </span>
                                              </div>
                                              <textarea
                                                value={(plan.features || []).join('\n')}
                                                onChange={(e) => {
                                                  const plans = [...(editingBlockContent.plans as Array<{ name: string; price: string; features: string[]; highlighted?: boolean }>)];
                                                  plans[idx] = { ...plans[idx], features: e.target.value.split('\n').filter(f => f.trim()) };
                                                  updateBlockField('plans', plans);
                                                }}
                                                placeholder={language === 'he' ? 'תכונה 1\nתכונה 2\nתכונה 3' : language === 'es' ? 'Característica 1\nCaracterística 2' : 'Feature 1\nFeature 2\nFeature 3'}
                                                rows={3}
                                                className="w-full px-2 py-1 bg-transparent border border-[var(--v2-border)] rounded text-[var(--v2-text-primary)] focus:outline-none focus:border-[#4F6EF7] text-sm resize-none"
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
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
                                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                      <p className="text-sm text-blue-700 dark:text-blue-300">
                                        {language === 'he' ? 'טפסים שנשלחו ייצרו אנשי קשר חדשים ב-CRM שלך אוטומטית.' : language === 'es' ? 'Los formularios enviados crearán contactos en tu CRM automáticamente.' : 'Submitted forms will automatically create contacts in your CRM.'}
                                      </p>
                                    </div>
                                  </>
                                )}

                                {/* Intake Form Block */}
                                {block.block_type === 'intake_form' && (
                                  <>
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-[var(--v2-text-secondary)]">
                                          {labels.section_title}
                                        </label>
                                        <button
                                          onClick={() => handleGenerateWithAI(block.id, 'title', 'Generate a welcoming intake form section title')}
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
                                          onClick={() => handleGenerateWithAI(block.id, 'subtitle', 'Generate a welcoming intake form section subtitle')}
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
                                        {language === 'he' ? 'תבנית שאלון' : language === 'es' ? 'Plantilla de Formulario' : 'Form Template'}
                                      </label>
                                      <Select
                                        value={(editingBlockContent.template as string) || 'general'}
                                        onValueChange={(value) => updateBlockField('template', value)}
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="general">{language === 'he' ? 'כללי' : language === 'es' ? 'General' : 'General'}</SelectItem>
                                          <SelectItem value="therapist">{language === 'he' ? 'מטפל/פסיכולוג' : language === 'es' ? 'Terapeuta' : 'Therapist'}</SelectItem>
                                          <SelectItem value="coach">{language === 'he' ? 'מאמן' : language === 'es' ? 'Coach' : 'Coach'}</SelectItem>
                                          <SelectItem value="consultant">{language === 'he' ? 'יועץ' : language === 'es' ? 'Consultor' : 'Consultant'}</SelectItem>
                                          <SelectItem value="fitness">{language === 'he' ? 'כושר/בריאות' : language === 'es' ? 'Fitness' : 'Fitness'}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                                      <p className="text-sm text-purple-700 dark:text-purple-300">
                                        {language === 'he' ? 'שאלון קליטה ימולא לפני הפגישה הראשונה ויישמר בפרופיל הלקוח.' : language === 'es' ? 'El formulario de admisión se completará antes de la primera cita.' : 'Intake form will be filled before the first appointment and saved to client profile.'}
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
                                    <div className="grid grid-cols-2 gap-4">
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
                      );
                    })}
                </div>
              </div>
            )}

            {/* Design Tab */}
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

                  {/* Heading Font */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.font_heading}
                    </label>
                    <Select
                      value={designForm.headingFont}
                      onValueChange={(value) => setDesignForm(prev => ({ ...prev, headingFont: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={labels.font_heading} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Inter">Inter</SelectItem>
                        <SelectItem value="Playfair Display">Playfair Display</SelectItem>
                        <SelectItem value="Montserrat">Montserrat</SelectItem>
                        <SelectItem value="Lora">Lora</SelectItem>
                        <SelectItem value="Poppins">Poppins</SelectItem>
                        <SelectItem value="Merriweather">Merriweather</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Body Font */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
                      {labels.font_body}
                    </label>
                    <Select
                      value={designForm.bodyFont}
                      onValueChange={(value) => setDesignForm(prev => ({ ...prev, bodyFont: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={labels.font_body} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Inter">Inter</SelectItem>
                        <SelectItem value="Open Sans">Open Sans</SelectItem>
                        <SelectItem value="Roboto">Roboto</SelectItem>
                        <SelectItem value="Source Sans Pro">Source Sans Pro</SelectItem>
                        <SelectItem value="Lato">Lato</SelectItem>
                        <SelectItem value="Nunito">Nunito</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
            {viewMode === 'settings' && (
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

            {/* Pages Tab */}
            {viewMode === 'pages' && (
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                      {labels.pages_title}
                    </h3>
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                      {labels.pages_desc}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowCreatePageModal(true)}
                    className="flex items-center gap-2 px-4 py-2 text-[#4F6EF7] text-sm font-medium border border-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <Plus className="h-4 w-4" />
                    {labels.add_landing_page}
                  </button>
                </div>

                {/* Pages List */}
                <div className="space-y-3">
                  {allPages.map((p) => {
                    const isCurrentPage = p.id === page?.id;
                    const isHomepage = p.page_type === 'homepage';
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                          isCurrentPage
                            ? 'bg-[#4F6EF7]/5 border-[#4F6EF7]'
                            : 'bg-[var(--v2-bg)] border-[var(--v2-border)] hover:border-[#4F6EF7]/50'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: isHomepage ? 'rgba(79, 110, 247, 0.1)' : 'rgba(236, 72, 153, 0.1)' }}
                          >
                            {isHomepage ? (
                              <Globe className="w-5 h-5" style={{ color: WEBSITE_COLOR }} />
                            ) : (
                              <FileText className="w-5 h-5 text-pink-500" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-[var(--v2-text-primary)]">
                              {p.title}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[var(--v2-text-muted)]">
                                {isHomepage ? labels.homepage : labels.landing_page}
                              </span>
                              {p.slug && !isHomepage && (
                                <span className="text-xs text-[var(--v2-text-muted)] font-mono">
                                  /{p.slug}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded ${
                                  p.status === 'live'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                }`}
                              >
                                {p.status === 'live' ? labels.status_live : labels.status_draft}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSelectPage(p)}
                            className={`px-3 py-1.5 text-sm font-medium transition-all ${
                              isCurrentPage
                                ? 'text-[#4F6EF7] bg-[#4F6EF7]/10 border border-[#4F6EF7]'
                                : 'text-[var(--v2-text-secondary)] hover:text-[#4F6EF7] border border-[var(--v2-border)] hover:border-[#4F6EF7]'
                            }`}
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {isCurrentPage ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              labels.edit_page
                            )}
                          </button>
                          <a
                            href={`/business-os/website/preview/${p.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-[var(--v2-text-muted)] hover:text-[#4F6EF7] transition-colors"
                            title={labels.preview}
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          {!isHomepage && (
                            <button
                              onClick={() => handleDeletePage(p.id)}
                              className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                              title={labels.delete_page}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {allPages.length === 0 && (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 mx-auto text-[var(--v2-text-muted)] mb-4 opacity-50" />
                      <p className="text-[var(--v2-text-secondary)]">
                        {labels.no_website_desc}
                      </p>
                    </div>
                  )}
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
                {page.template_id && (
                  <div className="mb-6 p-4 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                    <p className="text-xs text-[var(--v2-text-muted)] uppercase tracking-wider mb-1">
                      {labels.current_template}
                    </p>
                    <p className="font-medium text-[var(--v2-text-primary)]">
                      {getTranslatedTemplateName(templates.find(t => t.id === page.template_id)?.name || page.template_id, language)}
                    </p>
                  </div>
                )}

                {/* Template Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {templates.map((template) => {
                    const isCurrentTemplate = template.id === page.template_id;
                    const primaryColor = getTemplatePrimaryColor(template);
                    const secondaryColor = getTemplateSecondaryColor(template);
                    const blockTypes = template.blocks?.slice(0, 5) || [];
                    return (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: isCurrentTemplate ? 1 : 1.02 }}
                        whileTap={{ scale: isCurrentTemplate ? 1 : 0.98 }}
                        className={`group p-4 bg-[var(--v2-bg)] border text-start transition-all overflow-hidden ${
                          isCurrentTemplate
                            ? 'border-[#4F6EF7] ring-2 ring-[#4F6EF7]/20'
                            : 'border-[var(--v2-border)] hover:border-[#4F6EF7]'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                      >
                        {/* Template Preview Mockup */}
                        <div
                          className="w-full h-36 rounded-lg mb-4 overflow-hidden relative"
                          style={{ backgroundColor: '#1a1a2e' }}
                        >
                          {/* Header mockup */}
                          <div
                            className="h-2 w-full"
                            style={{ backgroundColor: primaryColor }}
                          />
                          {/* Hero section mockup */}
                          <div
                            className="mx-3 mt-3 h-10 rounded-sm flex items-center justify-center"
                            style={{ backgroundColor: `${primaryColor}30` }}
                          >
                            <div className="w-14 h-1.5 rounded" style={{ backgroundColor: primaryColor }} />
                          </div>
                          {/* Content blocks mockup */}
                          <div className="px-3 mt-2 space-y-1.5">
                            {blockTypes.slice(1, 4).map((block, idx) => (
                              <div
                                key={idx}
                                className="h-3.5 rounded-sm flex items-center gap-1 px-1"
                                style={{ backgroundColor: idx % 2 === 0 ? '#2a2a3e' : `${secondaryColor}20` }}
                              >
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: idx % 2 === 0 ? secondaryColor : primaryColor }}
                                />
                                <div className="flex-1 h-1 rounded bg-gray-600" />
                              </div>
                            ))}
                          </div>
                          {/* Brand voice badge */}
                          {template.theme?.brand_voice && (
                            <div
                              className="absolute bottom-2 right-2 px-2 py-0.5 text-[8px] font-medium rounded capitalize"
                              style={{
                                backgroundColor: `${primaryColor}30`,
                                color: primaryColor
                              }}
                            >
                              {template.theme.brand_voice}
                            </div>
                          )}
                          {/* Current template badge */}
                          {isCurrentTemplate && (
                            <div className="absolute top-2 right-2 px-2 py-0.5 text-[8px] font-medium rounded bg-[#4F6EF7] text-white">
                              Current
                            </div>
                          )}
                        </div>
                        {/* Template Info */}
                        <h3 className="font-semibold text-[var(--v2-text-primary)] mb-1">
                          {getTranslatedTemplateName(template.name, language)}
                        </h3>
                        <p className="text-xs text-[var(--v2-text-muted)] capitalize mb-2">
                          {getTranslatedVertical(template.vertical, language)}
                        </p>
                        {/* Block icons row */}
                        <div className="flex items-center gap-1 mb-3">
                          {blockTypes.slice(0, 4).map((block, idx) => {
                            const blockType = block.block_type || block.type || '';
                            const BlockIcon = getBlockIcon(blockType);
                            return (
                              <div
                                key={idx}
                                className="w-5 h-5 rounded flex items-center justify-center"
                                style={{ backgroundColor: `${primaryColor}15` }}
                                title={getBlockName(blockType)}
                              >
                                <BlockIcon className="w-3 h-3" style={{ color: primaryColor }} />
                              </div>
                            );
                          })}
                          {blockTypes.length > 4 && (
                            <span className="text-[10px] text-[var(--v2-text-muted)]">
                              +{blockTypes.length - 4}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => !isCurrentTemplate && handleApplyTemplate(template.id)}
                          disabled={isCurrentTemplate || applyingTemplate}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                            isCurrentTemplate
                              ? 'bg-[#4F6EF7]/10 text-[#4F6EF7] border border-[#4F6EF7]'
                              : 'bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] border border-[var(--v2-border)] hover:bg-[#4F6EF7] hover:text-white hover:border-[#4F6EF7]'
                          }`}
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          {isCurrentTemplate ? (
                            <>
                              <Check className="h-4 w-4" />
                              {labels.current_template}
                            </>
                          ) : applyingTemplate ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {labels.applying_template}
                            </>
                          ) : (
                            labels.apply_template
                          )}
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
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
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 w-full max-w-lg mx-4 shadow-2xl"
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
                        {getTranslatedTemplateName(template.name, language)}
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
          <div
            className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="sticky top-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] p-4 flex items-center justify-between">
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

            <div className="p-4">
              <p className="text-sm text-[var(--v2-text-muted)] mb-4">
                {language === 'he' ? 'בחר סוג חלק להוספה לאתר שלך' : language === 'es' ? 'Selecciona el tipo de sección para agregar a tu sitio' : 'Choose a section type to add to your website'}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { type: 'hero', icon: Target, label: { en: 'Hero', es: 'Encabezado', he: 'כותרת ראשית' }, desc: { en: 'Main headline section', es: 'Sección principal', he: 'חלק כותרת ראשי' } },
                  { type: 'services', icon: Package, label: { en: 'Services', es: 'Servicios', he: 'שירותים' }, desc: { en: 'List your services', es: 'Lista de servicios', he: 'רשימת השירותים' } },
                  { type: 'about', icon: User, label: { en: 'About', es: 'Acerca de', he: 'אודות' }, desc: { en: 'About you/company', es: 'Sobre ti/empresa', he: 'על העסק' } },
                  { type: 'cta', icon: Megaphone, label: { en: 'Call to Action', es: 'Llamada a Acción', he: 'קריאה לפעולה' }, desc: { en: 'Action prompt', es: 'Invitación a actuar', he: 'הנעה לפעולה' } },
                  { type: 'testimonials', icon: MessageCircle, label: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' }, desc: { en: 'Client reviews', es: 'Reseñas de clientes', he: 'חוות דעת' } },
                  { type: 'faq', icon: HelpCircle, label: { en: 'FAQ', es: 'Preguntas', he: 'שאלות נפוצות' }, desc: { en: 'Common questions', es: 'Preguntas frecuentes', he: 'שאלות ותשובות' } },
                  { type: 'pricing', icon: DollarSign, label: { en: 'Pricing', es: 'Precios', he: 'מחירון' }, desc: { en: 'Pricing plans', es: 'Planes de precios', he: 'תוכניות מחיר' } },
                  { type: 'features', icon: Sparkles, label: { en: 'Features', es: 'Características', he: 'תכונות' }, desc: { en: 'Key features', es: 'Características clave', he: 'יתרונות' } },
                  { type: 'process', icon: List, label: { en: 'Process', es: 'Proceso', he: 'תהליך' }, desc: { en: 'How it works', es: 'Cómo funciona', he: 'איך זה עובד' } },
                  { type: 'team', icon: Users, label: { en: 'Team', es: 'Equipo', he: 'צוות' }, desc: { en: 'Team members', es: 'Miembros del equipo', he: 'חברי הצוות' } },
                  { type: 'stats', icon: BarChart3, label: { en: 'Stats', es: 'Estadísticas', he: 'סטטיסטיקות' }, desc: { en: 'Key metrics', es: 'Métricas clave', he: 'נתונים' } },
                  { type: 'gallery', icon: ImageIcon, label: { en: 'Gallery', es: 'Galería', he: 'גלריה' }, desc: { en: 'Image gallery', es: 'Galería de imágenes', he: 'גלריית תמונות' } },
                  { type: 'video', icon: Video, label: { en: 'Video', es: 'Video', he: 'וידאו' }, desc: { en: 'Embedded video', es: 'Video incrustado', he: 'סרטון' } },
                  { type: 'contact_form', icon: Mail, label: { en: 'Contact Form', es: 'Formulario', he: 'טופס יצירת קשר' }, desc: { en: 'Contact form', es: 'Formulario de contacto', he: 'טופס פנייה' } },
                  { type: 'intake_form', icon: FileText, label: { en: 'Intake Form', es: 'Formulario Inicial', he: 'טופס קליטה' }, desc: { en: 'Client intake', es: 'Formulario de admisión', he: 'שאלון התחלתי' } },
                  { type: 'booking_widget', icon: Calendar, label: { en: 'Booking', es: 'Reservas', he: 'הזמנת תור' }, desc: { en: 'Book appointments', es: 'Reservar citas', he: 'קביעת פגישות' } },
                  { type: 'payment_button', icon: CreditCard, label: { en: 'Payment', es: 'Pago', he: 'תשלום' }, desc: { en: 'Payment button', es: 'Botón de pago', he: 'כפתור תשלום' } },
                  { type: 'newsletter', icon: Newspaper, label: { en: 'Newsletter', es: 'Boletín', he: 'ניוזלטר' }, desc: { en: 'Email signup', es: 'Suscripción', he: 'הרשמה לעדכונים' } },
                  { type: 'logo_cloud', icon: Briefcase, label: { en: 'Logo Cloud', es: 'Logos', he: 'לוגואים' }, desc: { en: 'Partner logos', es: 'Logos de socios', he: 'לוגואים של שותפים' } },
                ].map(({ type, icon: Icon, label, desc }) => (
                  <button
                    key={type}
                    onClick={() => handleAddSection(type)}
                    disabled={addingSection}
                    className="flex flex-col items-center gap-2 p-4 border border-[var(--v2-border)] rounded-lg hover:border-[#4F6EF7] hover:bg-[#4F6EF7]/5 transition-all disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#4F6EF7]/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-[#4F6EF7]" />
                    </div>
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {label[language] || label.en}
                    </span>
                    <span className="text-xs text-[var(--v2-text-muted)] text-center">
                      {desc[language] || desc.en}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
