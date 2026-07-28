/**
 * Website Building Blocks
 * Reusable components that can be assembled into templates
 * Each block has a type, default content, and styling
 */

export type BuildingBlockType =
  | 'header'
  | 'hero'
  | 'cta'
  | 'services'
  | 'testimonials'
  | 'contact_form'
  | 'pricing'
  | 'faq'
  | 'about'
  | 'features'
  | 'stats'
  | 'booking_widget'
  | 'payment_button'
  | 'team'
  | 'process'
  | 'gallery'
  | 'newsletter'
  | 'logo_cloud'
  | 'video';

// =============================================
// HEADER MENU ITEM INTERFACE
// =============================================

export interface HeaderMenuItem {
  label: string;
  anchor: string;
  icon?: string;
}

// =============================================
// HEADER BLOCKS
// =============================================

export const HeaderBlock = {
  standard: (data: {
    logo_text: string;
    logo_url?: string;
    menu_items: HeaderMenuItem[];
    cta_button?: { text: string; link: string };
    sticky?: boolean;
    style?: 'solid' | 'transparent' | 'blur';
  }): BuildingBlock => ({
    block_type: 'header',
    position: 0,
    content: {
      logo_text: data.logo_text,
      logo_url: data.logo_url,
      menu_items: data.menu_items,
      cta_button: data.cta_button,
      sticky: data.sticky ?? true,
      style: data.style || 'solid',
      layout: 'standard'
    },
    styles: {
      padding: 'py-4'
    }
  }),

  minimal: (data: {
    logo_text: string;
    menu_items: HeaderMenuItem[];
  }): BuildingBlock => ({
    block_type: 'header',
    position: 0,
    content: {
      logo_text: data.logo_text,
      menu_items: data.menu_items,
      sticky: true,
      style: 'transparent',
      layout: 'minimal'
    },
    styles: {
      padding: 'py-4'
    }
  }),

  centered: (data: {
    logo_text: string;
    logo_url?: string;
    menu_items: HeaderMenuItem[];
    cta_button?: { text: string; link: string };
  }): BuildingBlock => ({
    block_type: 'header',
    position: 0,
    content: {
      logo_text: data.logo_text,
      logo_url: data.logo_url,
      menu_items: data.menu_items,
      cta_button: data.cta_button,
      layout: 'centered',
      sticky: true,
      style: 'blur'
    },
    styles: {
      padding: 'py-5'
    }
  }),

  dark: (data: {
    logo_text: string;
    menu_items: HeaderMenuItem[];
    cta_button?: { text: string; link: string };
  }): BuildingBlock => ({
    block_type: 'header',
    position: 0,
    content: {
      logo_text: data.logo_text,
      menu_items: data.menu_items,
      cta_button: data.cta_button,
      sticky: true,
      style: 'solid',
      layout: 'standard'
    },
    styles: {
      padding: 'py-4',
      background: 'bg-slate-950'
    }
  })
};

export interface BuildingBlock {
  block_type: BuildingBlockType;
  position: number;
  content: Record<string, any>;
  styles?: Record<string, any>;
}

// =============================================
// HERO BLOCKS
// =============================================

export const HeroBlock = {
  professional: (data: { name: string; tagline: string; cta: string }): BuildingBlock => ({
    block_type: 'hero',
    position: 0,
    content: {
      headline: data.tagline,
      subheadline: `Professional ${data.name}`,
      cta_text: data.cta,
      cta_link: '#contact',
      background_type: 'gradient',
      background_value: 'from-blue-50 to-purple-50 dark:from-slate-900 dark:to-slate-800'
    },
    styles: {
      alignment: 'center',
      padding: 'py-20 sm:py-32',
      text_color: 'text-gray-900 dark:text-white'
    }
  }),

  warm: (data: { name: string; tagline: string; cta: string }): BuildingBlock => ({
    block_type: 'hero',
    position: 0,
    content: {
      headline: data.tagline,
      subheadline: `Welcome to ${data.name}`,
      cta_text: data.cta,
      cta_link: '#contact',
      background_type: 'gradient',
      background_value: 'from-orange-50 to-pink-50 dark:from-slate-900 dark:to-purple-900'
    },
    styles: {
      alignment: 'center',
      padding: 'py-20 sm:py-32',
      text_color: 'text-gray-900 dark:text-white'
    }
  }),

  minimal: (data: { name: string; tagline: string; cta: string }): BuildingBlock => ({
    block_type: 'hero',
    position: 0,
    content: {
      headline: data.tagline,
      subheadline: data.name,
      cta_text: data.cta,
      cta_link: '#contact',
      background_type: 'solid',
      background_value: 'bg-white dark:bg-slate-950'
    },
    styles: {
      alignment: 'left',
      padding: 'py-16 sm:py-24',
      text_color: 'text-gray-900 dark:text-white'
    }
  })
};

// =============================================
// SERVICES BLOCKS
// =============================================

export const ServicesBlock = {
  grid: (services: Array<{ name: string; description: string; icon?: string }>): BuildingBlock => ({
    block_type: 'services',
    position: 1,
    content: {
      title: 'Services',
      subtitle: 'How I can help you',
      services: services.map(s => ({
        name: s.name,
        description: s.description,
        icon: s.icon || '🔹'
      })),
      layout: 'grid'
    },
    styles: {
      columns: services.length === 2 ? 2 : 3,
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  }),

  list: (services: Array<{ name: string; description: string; price?: string }>): BuildingBlock => ({
    block_type: 'services',
    position: 1,
    content: {
      title: 'Services & Pricing',
      subtitle: '',
      services: services.map(s => ({
        name: s.name,
        description: s.description,
        price: s.price
      })),
      layout: 'list'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  })
};

// =============================================
// CTA BLOCKS
// =============================================

export const CTABlock = {
  primary: (data: { title: string; description: string; button_text: string }): BuildingBlock => ({
    block_type: 'cta',
    position: 2,
    content: {
      title: data.title,
      description: data.description,
      button_text: data.button_text,
      button_link: '#contact',
      style: 'primary'
    },
    styles: {
      alignment: 'center',
      padding: 'py-12 sm:py-16',
      background: 'bg-gradient-to-r from-blue-600 to-purple-600',
      text_color: 'text-white'
    }
  }),

  subtle: (data: { title: string; description: string; button_text: string }): BuildingBlock => ({
    block_type: 'cta',
    position: 2,
    content: {
      title: data.title,
      description: data.description,
      button_text: data.button_text,
      button_link: '#contact',
      style: 'subtle'
    },
    styles: {
      alignment: 'center',
      padding: 'py-12 sm:py-16',
      background: 'bg-gray-100 dark:bg-slate-800',
      text_color: 'text-gray-900 dark:text-white'
    }
  })
};

// =============================================
// CONTACT FORM BLOCK
// =============================================

export const ContactFormBlock = {
  standard: (data: { title: string; email: string }): BuildingBlock => ({
    block_type: 'contact_form',
    position: 3,
    content: {
      title: data.title,
      fields: [
        { name: 'name', type: 'text', label: 'Name', required: true },
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'phone', type: 'tel', label: 'Phone', required: false },
        { name: 'message', type: 'textarea', label: 'Message', required: true }
      ],
      submit_text: 'Send Message',
      recipient_email: data.email,
      success_message: 'Thank you! I\'ll get back to you soon.',
      // Auto-create CRM contact on submit
      crm_integration: true
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  })
};

// =============================================
// TESTIMONIALS BLOCK
// =============================================

export const TestimonialsBlock = {
  carousel: (testimonials: Array<{ quote: string; author: string; role?: string }>): BuildingBlock => ({
    block_type: 'testimonials',
    position: 4,
    content: {
      title: 'What Clients Say',
      testimonials: testimonials.map(t => ({
        quote: t.quote,
        author: t.author,
        role: t.role || ''
      })),
      layout: 'carousel'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  }),

  grid: (testimonials: Array<{ quote: string; author: string; role?: string }>): BuildingBlock => ({
    block_type: 'testimonials',
    position: 4,
    content: {
      title: 'Client Success Stories',
      testimonials: testimonials.map(t => ({
        quote: t.quote,
        author: t.author,
        role: t.role || ''
      })),
      layout: 'grid'
    },
    styles: {
      columns: 3,
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  })
};

// =============================================
// PRICING BLOCK
// =============================================

export const PricingBlock = {
  simple: (plans: Array<{ name: string; price: string; features: string[]; popular?: boolean }>): BuildingBlock => ({
    block_type: 'pricing',
    position: 5,
    content: {
      title: 'Pricing',
      subtitle: 'Choose the option that works for you',
      plans: plans.map(p => ({
        name: p.name,
        price: p.price,
        features: p.features,
        popular: p.popular || false,
        cta_text: 'Get Started',
        cta_link: '#contact'
      }))
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// FAQ BLOCK
// =============================================

export const FAQBlock = {
  accordion: (faqs: Array<{ question: string; answer: string }>): BuildingBlock => ({
    block_type: 'faq',
    position: 6,
    content: {
      title: 'Frequently Asked Questions',
      faqs: faqs.map(f => ({
        question: f.question,
        answer: f.answer
      }))
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  })
};

// =============================================
// ABOUT BLOCK
// =============================================

export const AboutBlock = {
  withImage: (data: { title: string; content: string; image?: string }): BuildingBlock => ({
    block_type: 'about',
    position: 7,
    content: {
      title: data.title,
      content: data.content,
      image: data.image || '/placeholder-profile.jpg',
      layout: 'side-by-side'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  }),

  textOnly: (data: { title: string; content: string }): BuildingBlock => ({
    block_type: 'about',
    position: 7,
    content: {
      title: data.title,
      content: data.content,
      layout: 'text-only'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950',
      max_width: '2xl'
    }
  })
};

// =============================================
// BOOKING WIDGET BLOCK (connects to Scheduling capability)
// =============================================

export const BookingWidgetBlock = {
  embedded: (data: { title: string; services: string[] }): BuildingBlock => ({
    block_type: 'booking_widget',
    position: 8,
    content: {
      title: data.title,
      subtitle: 'Schedule your appointment',
      services: data.services,
      // Will connect to scheduling capability when activated
      capability_integration: 'scheduling',
      inline_calendar: true
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  }),

  button: (data: { text: string; service_id?: string }): BuildingBlock => ({
    block_type: 'booking_widget',
    position: 8,
    content: {
      text: data.text,
      service_id: data.service_id,
      capability_integration: 'scheduling',
      inline_calendar: false,
      redirect_to_scheduler: true
    },
    styles: {
      padding: 'py-8 sm:py-12',
      alignment: 'center'
    }
  })
};

// =============================================
// PAYMENT BUTTON BLOCK (connects to Payment capability)
// =============================================

export const PaymentButtonBlock = {
  standard: (data: { text: string; amount: number; description: string }): BuildingBlock => ({
    block_type: 'payment_button',
    position: 9,
    content: {
      text: data.text,
      amount: data.amount,
      currency: 'USD',
      description: data.description,
      // Will connect to payment capability when activated
      capability_integration: 'payments',
      payment_type: 'one_time'
    },
    styles: {
      padding: 'py-8 sm:py-12',
      alignment: 'center',
      button_color: 'bg-green-600 hover:bg-green-700'
    }
  })
};

// =============================================
// FEATURES BLOCK
// =============================================

export const FeaturesBlock = {
  grid: (features: Array<{ title: string; description: string; icon?: string }>): BuildingBlock => ({
    block_type: 'features',
    position: 10,
    content: {
      title: 'Why Choose Us',
      subtitle: 'What makes us different',
      features: features.map(f => ({
        title: f.title,
        description: f.description,
        icon: f.icon || '✓'
      })),
      layout: 'grid'
    },
    styles: {
      columns: features.length <= 3 ? features.length : 3,
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  }),

  list: (features: Array<{ title: string; description: string }>): BuildingBlock => ({
    block_type: 'features',
    position: 10,
    content: {
      title: 'What You Get',
      features: features.map(f => ({
        title: f.title,
        description: f.description,
        icon: '✓'
      })),
      layout: 'list'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// STATS BLOCK
// =============================================

export const StatsBlock = {
  horizontal: (stats: Array<{ value: string; label: string }>): BuildingBlock => ({
    block_type: 'stats',
    position: 11,
    content: {
      title: 'By the Numbers',
      stats: stats.map(s => ({
        value: s.value,
        label: s.label
      })),
      layout: 'horizontal'
    },
    styles: {
      columns: stats.length,
      padding: 'py-12 sm:py-16',
      background: 'bg-gradient-to-r from-blue-600 to-purple-600',
      text_color: 'text-white'
    }
  }),

  grid: (stats: Array<{ value: string; label: string; description?: string }>): BuildingBlock => ({
    block_type: 'stats',
    position: 11,
    content: {
      stats: stats.map(s => ({
        value: s.value,
        label: s.label,
        description: s.description || ''
      })),
      layout: 'grid'
    },
    styles: {
      columns: 4,
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  })
};

// =============================================
// TEAM BLOCK
// =============================================

export const TeamBlock = {
  grid: (members: Array<{ name: string; role: string; bio?: string; image?: string }>): BuildingBlock => ({
    block_type: 'team',
    position: 12,
    content: {
      title: 'Meet the Team',
      members: members.map(m => ({
        name: m.name,
        role: m.role,
        bio: m.bio || '',
        image: m.image || '/placeholder-profile.jpg'
      })),
      layout: 'grid'
    },
    styles: {
      columns: members.length <= 3 ? members.length : 3,
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// PROCESS/STEPS BLOCK
// =============================================

export const ProcessBlock = {
  numbered: (steps: Array<{ title: string; description: string }>): BuildingBlock => ({
    block_type: 'process',
    position: 13,
    content: {
      title: 'How It Works',
      subtitle: 'Simple steps to get started',
      steps: steps.map((s, idx) => ({
        number: idx + 1,
        title: s.title,
        description: s.description
      })),
      layout: 'numbered'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  }),

  timeline: (steps: Array<{ title: string; description: string }>): BuildingBlock => ({
    block_type: 'process',
    position: 13,
    content: {
      title: 'Our Process',
      steps: steps.map(s => ({
        title: s.title,
        description: s.description
      })),
      layout: 'timeline'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// GALLERY BLOCK
// =============================================

export const GalleryBlock = {
  masonry: (images: Array<{ url: string; alt: string; caption?: string }>): BuildingBlock => ({
    block_type: 'gallery',
    position: 14,
    content: {
      title: 'Gallery',
      images: images.map(i => ({
        url: i.url,
        alt: i.alt,
        caption: i.caption || ''
      })),
      layout: 'masonry'
    },
    styles: {
      columns: 3,
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950'
    }
  }),

  grid: (images: Array<{ url: string; alt: string }>): BuildingBlock => ({
    block_type: 'gallery',
    position: 14,
    content: {
      images: images.map(i => ({
        url: i.url,
        alt: i.alt
      })),
      layout: 'grid'
    },
    styles: {
      columns: 4,
      padding: 'py-16 sm:py-24',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// NEWSLETTER SIGNUP BLOCK
// =============================================

export const NewsletterBlock = {
  inline: (data: { title: string; description: string }): BuildingBlock => ({
    block_type: 'newsletter',
    position: 15,
    content: {
      title: data.title,
      description: data.description,
      placeholder: 'Enter your email',
      button_text: 'Subscribe',
      success_message: 'Thanks for subscribing!',
      // Auto-create CRM contact with tag "newsletter"
      crm_integration: true,
      crm_tag: 'newsletter'
    },
    styles: {
      padding: 'py-12 sm:py-16',
      background: 'bg-gradient-to-r from-purple-600 to-pink-600',
      text_color: 'text-white',
      layout: 'inline'
    }
  }),

  card: (data: { title: string; description: string }): BuildingBlock => ({
    block_type: 'newsletter',
    position: 15,
    content: {
      title: data.title,
      description: data.description,
      placeholder: 'Your email address',
      button_text: 'Get Updates',
      success_message: 'You\'re subscribed!',
      crm_integration: true,
      crm_tag: 'newsletter'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950',
      layout: 'card',
      max_width: 'lg'
    }
  })
};

// =============================================
// LOGO CLOUD BLOCK
// =============================================

export const LogoCloudBlock = {
  simple: (data: { title?: string; logos: Array<{ name: string; url: string }> }): BuildingBlock => ({
    block_type: 'logo_cloud',
    position: 16,
    content: {
      title: data.title || 'Trusted By',
      logos: data.logos.map(l => ({
        name: l.name,
        url: l.url
      }))
    },
    styles: {
      padding: 'py-12 sm:py-16',
      background: 'bg-gray-50 dark:bg-slate-900'
    }
  })
};

// =============================================
// VIDEO BLOCK
// =============================================

export const VideoBlock = {
  embedded: (data: { title?: string; video_url: string; description?: string }): BuildingBlock => ({
    block_type: 'video',
    position: 17,
    content: {
      title: data.title || '',
      video_url: data.video_url,
      description: data.description || '',
      provider: 'youtube' // or 'vimeo', 'custom'
    },
    styles: {
      padding: 'py-16 sm:py-24',
      background: 'bg-white dark:bg-slate-950',
      aspect_ratio: '16/9'
    }
  })
};
