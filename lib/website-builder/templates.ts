/**
 * Website Templates
 * Pre-built templates that define VISUAL STYLING only (colors, fonts, brand voice).
 *
 * ARCHITECTURE:
 * - Templates define THEME (colors, fonts, brand_voice) - the visual identity
 * - STANDARD_HOMEPAGE_BLOCKS defines WHICH sections all homepages have (fixed structure)
 * - Content comes from the central website_content table (user-customizable)
 * - When applying a template, we use STANDARD_HOMEPAGE_BLOCKS + template.theme
 *
 * This ensures:
 * 1. All templates have the same sections (consistent structure)
 * 2. Template switching only changes visual appearance, not content structure
 * 3. User content persists across template changes
 */

import {
  HeaderBlock,
  HeroBlock,
  ServicesBlock,
  CTABlock,
  ContactFormBlock,
  TestimonialsBlock,
  PricingBlock,
  FAQBlock,
  AboutBlock,
  FeaturesBlock,
  StatsBlock,
  ProcessBlock,
  BookingWidgetBlock,
  GalleryBlock,
  type BuildingBlock
} from './building-blocks';

// =============================================
// STANDARD HOMEPAGE BLOCKS
// All homepage templates use this SAME structure
// Content is populated from central website_content
// =============================================

/**
 * Standard homepage block structure used by ALL templates.
 * This defines WHICH sections exist - content comes from website_content table.
 * Templates only change the visual styling (theme), not the structure.
 */
export function getStandardHomepageBlocks(): BuildingBlock[] {
  return [
    // 1. Header - Navigation
    HeaderBlock.standard({
      logo_text: 'Your Business',
      menu_items: [
        { label: 'About', anchor: '#about' },
        { label: 'Services', anchor: '#services' },
        { label: 'Process', anchor: '#process' },
        { label: 'Testimonials', anchor: '#testimonials' },
        { label: 'Contact', anchor: '#contact' }
      ],
      cta_button: { text: 'Book Now', link: '#booking' },
      style: 'blur'
    }),

    // 2. Hero - Main headline and CTA
    HeroBlock.warm({
      name: 'Your Business',
      tagline: 'Professional Services for Your Needs',
      cta: 'Get Started'
    }),

    // 3. About - Business story/bio
    AboutBlock.withImage({
      title: 'About',
      content: 'Tell your story here. Share your background, expertise, and what makes you unique.'
    }),

    // 4. Services - What you offer (content from Scheduling capability)
    ServicesBlock.grid([
      { name: 'Service 1', description: 'Description of your first service', icon: 'Star' },
      { name: 'Service 2', description: 'Description of your second service', icon: 'Star' },
      { name: 'Service 3', description: 'Description of your third service', icon: 'Star' }
    ]),

    // 5. Process - How it works
    ProcessBlock.numbered([
      { title: 'Initial Consultation', description: 'Free 15-minute call to discuss your needs' },
      { title: 'First Session', description: 'Begin building a therapeutic relationship' },
      { title: 'Ongoing Support', description: 'Regular sessions to support your growth' }
    ]),

    // 6. Testimonials - Social proof
    TestimonialsBlock.carousel([
      { quote: 'Amazing experience! Highly recommended.', author: 'Client Name', role: 'Client' },
      { quote: 'Professional and caring service.', author: 'Another Client', role: 'Client' }
    ]),

    // 7. FAQ - Common questions
    FAQBlock.accordion([
      { question: 'What should I expect?', answer: 'Answer to your frequently asked question.' },
      { question: 'How do I get started?', answer: 'Simply book a consultation to get started.' }
    ]),

    // 8. Booking Widget - Schedule appointments (connects to Scheduling)
    BookingWidgetBlock.embedded({
      title: 'Book an Appointment',
      services: []
    }),

    // 9. Contact Form - Get in touch
    ContactFormBlock.standard({
      title: 'Get in Touch',
      email: 'contact@yourbusiness.com'
    })
  ];
}

export interface WebsiteTemplate {
  id: string;
  name: string;
  description: string;
  vertical: string;
  template_type: 'homepage' | 'landing' | 'service' | 'course';
  thumbnail_url?: string;
  blocks: BuildingBlock[];
  theme: {
    primary_color: string;
    secondary_color: string;
    accent_color?: string;
    font_heading: string;
    font_body: string;
    font_family: string; // Backward compatibility
    brand_voice: 'professional' | 'warm' | 'minimal' | 'bold' | 'elegant' | 'creative';
    background_color?: string;
    text_color?: string;
  };
  keywords?: string[];
}

// =============================================
// THERAPIST TEMPLATES (4)
// Calming, organic, soft colors
// =============================================

export const TherapistTemplates: WebsiteTemplate[] = [
  {
    id: 'therapist_warm_welcoming',
    name: 'Warm & Welcoming',
    description: 'Empathetic design with calming sage tones',
    vertical: 'therapist',
    template_type: 'homepage',
    thumbnail_url: '/templates/therapist-warm.jpg',
    keywords: ['empathy', 'comfort', 'safe space', 'healing', 'warmth'],
    theme: {
      primary_color: '#7C9082',
      secondary_color: '#E8DDD4',
      accent_color: '#C9A87C',
      font_heading: 'Lora',
      font_body: 'Nunito',
      font_family: 'Lora, serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Your Practice',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Process', anchor: '#process' },
          { label: 'Testimonials', anchor: '#testimonials' }
        ],
        cta_button: { text: 'Book Session', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Your Practice',
        tagline: 'A Safe Space for Healing and Growth',
        cta: 'Schedule a Consultation'
      }),
      AboutBlock.withImage({
        title: 'About Me',
        content: 'I provide compassionate, evidence-based therapy to help you navigate life\'s challenges. With a warm and supportive approach, we\'ll work together to uncover your strengths and build a path toward healing.'
      }),
      ServicesBlock.grid([
        { name: 'Individual Therapy', description: 'One-on-one sessions tailored to your unique journey', icon: 'Heart' },
        { name: 'Couples Therapy', description: 'Strengthen your relationship and deepen connection', icon: 'Users' },
        { name: 'Family Therapy', description: 'Build healthier family dynamics together', icon: 'Home' }
      ]),
      ProcessBlock.numbered([
        { title: 'Free Consultation', description: 'A brief call to understand your needs and answer questions' },
        { title: 'First Session', description: 'Begin your journey in a safe, supportive environment' },
        { title: 'Ongoing Growth', description: 'Regular sessions to support your continued healing' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Finally found a therapist who truly listens. This space has been transformative for my healing journey.', author: 'Sarah M.', role: 'Client' },
        { quote: 'The warmth and understanding I\'ve experienced here helped me open up in ways I never thought possible.', author: 'Michael R.', role: 'Client' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Begin Your Healing Journey',
        services: ['Individual Therapy', 'Couples Therapy', 'Family Therapy']
      }),
      ContactFormBlock.standard({
        title: 'Questions? Reach Out',
        email: 'contact@therapypractice.com'
      })
    ]
  },

  {
    id: 'therapist_professional_clinical',
    name: 'Professional & Clinical',
    description: 'Clean, credentialed design with deep teal tones',
    vertical: 'therapist',
    template_type: 'homepage',
    keywords: ['clinical', 'professional', 'credentials', 'evidence-based', 'licensed'],
    theme: {
      primary_color: '#2D5A5A',
      secondary_color: '#5B9A8B',
      accent_color: '#F5F0E8',
      font_heading: 'Merriweather',
      font_body: 'Open Sans',
      font_family: 'Merriweather, serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Clinical Practice',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Credentials', anchor: '#features' },
          { label: 'FAQ', anchor: '#faq' }
        ],
        cta_button: { text: 'Request Appointment', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Clinical Practice',
        tagline: 'Evidence-Based Therapy for Lasting Change',
        cta: 'Request Appointment'
      }),
      StatsBlock.horizontal([
        { value: '15+', label: 'Years Experience' },
        { value: '500+', label: 'Clients Helped' },
        { value: '98%', label: 'Client Satisfaction' }
      ]),
      ServicesBlock.list([
        { name: 'Individual Therapy', description: 'CBT, DBT, and psychodynamic approaches for depression, anxiety, and trauma', price: '$150/session' },
        { name: 'Couples Therapy', description: 'Emotionally Focused Therapy (EFT) to rebuild connection', price: '$200/session' },
        { name: 'EMDR', description: 'Specialized trauma processing for PTSD and complex trauma', price: '$175/session' }
      ]),
      FeaturesBlock.grid([
        { title: 'Licensed & Board Certified', description: 'PhD in Clinical Psychology with specialized training', icon: 'Award' },
        { title: 'HIPAA Compliant', description: 'Your privacy is fully protected', icon: 'Shield' },
        { title: 'Insurance Accepted', description: 'In-network with most major providers', icon: 'CreditCard' },
        { title: 'Evidence-Based', description: 'Proven therapeutic methods backed by research', icon: 'BookOpen' }
      ]),
      FAQBlock.accordion([
        { question: 'Do you accept insurance?', answer: 'Yes, I am in-network with most major insurance providers including Blue Cross, Aetna, and United Healthcare.' },
        { question: 'How long are sessions?', answer: 'Standard individual sessions are 50 minutes. Couples and family sessions are typically 75-90 minutes.' },
        { question: 'Is therapy confidential?', answer: 'Absolutely. All sessions are protected by HIPAA and professional ethics standards.' },
        { question: 'Do you offer virtual sessions?', answer: 'Yes, I offer secure telehealth sessions through a HIPAA-compliant platform.' }
      ]),
      ProcessBlock.numbered([
        { title: 'Schedule Consultation', description: 'Book a free 15-minute consultation call' },
        { title: 'First Appointment', description: 'Complete intake and begin your journey' },
        { title: 'Ongoing Care', description: 'Regular sessions tailored to your needs' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Request an Appointment',
        services: ['Individual Therapy', 'Couples Therapy', 'EMDR']
      }),
      ContactFormBlock.standard({
        title: 'Have Questions?',
        email: 'appointments@clinicalpractice.com'
      })
    ]
  },

  {
    id: 'therapist_modern_minimal',
    name: 'Modern & Minimal',
    description: 'Sleek, contemporary design with slate blue palette',
    vertical: 'therapist',
    template_type: 'homepage',
    keywords: ['modern', 'minimal', 'clean', 'contemporary', 'urban'],
    theme: {
      primary_color: '#4A6670',
      secondary_color: '#E9EEF0',
      accent_color: '#B8A9A3',
      font_heading: 'DM Serif Display',
      font_body: 'Inter',
      font_family: 'DM Serif Display, serif',
      brand_voice: 'minimal'
    },
    blocks: [
      HeaderBlock.minimal({
        logo_text: 'Therapy',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Book', anchor: '#booking' },
          { label: 'Contact', anchor: '#contact' }
        ]
      }),
      HeroBlock.minimal({
        name: 'Modern Therapy Practice',
        tagline: 'Clear Mind. Balanced Life.',
        cta: 'Start Your Journey'
      }),
      AboutBlock.textOnly({
        title: 'A Different Approach',
        content: 'I believe therapy should fit seamlessly into your modern life. No outdated methods or overwhelming processes—just effective, evidence-based care delivered with clarity and purpose.'
      }),
      ServicesBlock.grid([
        { name: 'Anxiety & Stress', description: 'Practical tools for managing modern life pressures', icon: 'Brain' },
        { name: 'Life Transitions', description: 'Navigate change with clarity and confidence', icon: 'Compass' },
        { name: 'Self-Development', description: 'Unlock your potential and live intentionally', icon: 'Target' }
      ]),
      PricingBlock.simple([
        { name: 'Single Session', price: '$160', features: ['50-minute session', 'Flexible scheduling', 'In-person or virtual'] },
        { name: 'Monthly Package', price: '$550', features: ['4 sessions per month', 'Priority booking', 'Between-session support', 'Save $90'], popular: true }
      ]),
      ProcessBlock.numbered([
        { title: 'Book Online', description: 'Select a time that works for you' },
        { title: 'Brief Intake', description: 'Quick questionnaire before your session' },
        { title: 'First Session', description: 'Begin your journey to clarity' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Book Online',
        services: ['Anxiety & Stress', 'Life Transitions', 'Self-Development']
      }),
      ContactFormBlock.standard({
        title: 'Get in Touch',
        email: 'hello@moderntherapy.com'
      })
    ]
  },

  {
    id: 'therapist_specialized_trauma',
    name: 'Trauma-Focused',
    description: 'Gentle, specialized design with calming lavender tones',
    vertical: 'therapist',
    template_type: 'homepage',
    keywords: ['trauma', 'PTSD', 'EMDR', 'healing', 'recovery', 'specialized'],
    theme: {
      primary_color: '#6B5B95',
      secondary_color: '#DCD0E8',
      accent_color: '#F2C4CE',
      font_heading: 'Playfair Display',
      font_body: 'Lato',
      font_family: 'Playfair Display, serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Trauma Recovery',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Specializations', anchor: '#services' },
          { label: 'Approach', anchor: '#process' },
          { label: 'Resources', anchor: '#faq' }
        ],
        cta_button: { text: 'Free Consultation', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Trauma Recovery Center',
        tagline: 'Healing is Possible. You Don\'t Have to Face This Alone.',
        cta: 'Begin Your Recovery'
      }),
      AboutBlock.withImage({
        title: 'Specialized Trauma Care',
        content: 'I specialize in helping survivors of trauma reclaim their lives. With advanced training in EMDR, somatic therapy, and trauma-informed care, I provide a safe haven for your healing journey.'
      }),
      ServicesBlock.grid([
        { name: 'EMDR Therapy', description: 'Process traumatic memories and reduce their emotional impact', icon: 'Eye' },
        { name: 'Complex Trauma', description: 'Specialized support for childhood and developmental trauma', icon: 'Heart' },
        { name: 'PTSD Treatment', description: 'Evidence-based approaches for post-traumatic stress', icon: 'Shield' },
        { name: 'Somatic Therapy', description: 'Release trauma stored in the body', icon: 'Activity' }
      ]),
      ProcessBlock.numbered([
        { title: 'Safety First', description: 'We\'ll establish grounding techniques and coping strategies' },
        { title: 'Understanding Your Story', description: 'Gently explore your experiences at your own pace' },
        { title: 'Processing & Healing', description: 'Work through trauma using specialized techniques' },
        { title: 'Integration', description: 'Build a new narrative and reclaim your life' }
      ]),
      FAQBlock.accordion([
        { question: 'Is it normal to feel scared about starting trauma therapy?', answer: 'Absolutely. It takes courage to seek help. We\'ll go at your pace, and you\'re always in control.' },
        { question: 'What is EMDR?', answer: 'EMDR (Eye Movement Desensitization and Reprocessing) is an evidence-based therapy that helps the brain process traumatic memories.' },
        { question: 'How long does trauma therapy take?', answer: 'Every journey is unique. Some find relief in months, while others benefit from longer-term support.' }
      ]),
      ContactFormBlock.standard({
        title: 'Take the First Step',
        email: 'healing@traumarecovery.com'
      })
    ]
  }
];

// =============================================
// COACH TEMPLATES (4)
// Energetic, bold, motivational
// =============================================

export const CoachTemplates: WebsiteTemplate[] = [
  {
    id: 'coach_inspiring_transformation',
    name: 'Inspiring Transformation',
    description: 'Bold, energetic design with amber and red tones',
    vertical: 'coach',
    template_type: 'homepage',
    keywords: ['transformation', 'motivation', 'energy', 'change', 'breakthrough'],
    theme: {
      primary_color: '#F59E0B',
      secondary_color: '#DC2626',
      accent_color: '#1F2937',
      font_heading: 'Poppins',
      font_body: 'Inter',
      font_family: 'Poppins, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'TRANSFORM',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Programs', anchor: '#services' },
          { label: 'Results', anchor: '#testimonials' },
          { label: 'Book', anchor: '#booking' }
        ],
        cta_button: { text: 'Start Now', link: '#booking' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Transformation Coaching',
        tagline: 'Unlock Your Potential. Transform Your Life.',
        cta: 'Book Free Discovery Call'
      }),
      StatsBlock.horizontal([
        { value: '1000+', label: 'Lives Transformed' },
        { value: '95%', label: 'Goal Achievement' },
        { value: '10+', label: 'Years Coaching' }
      ]),
      AboutBlock.withImage({
        title: 'Your Transformation Starts Here',
        content: 'I\'ve helped thousands break through their limitations and achieve what they once thought impossible. Ready to become the person you\'ve always wanted to be?'
      }),
      ServicesBlock.grid([
        { name: '1:1 Breakthrough Coaching', description: 'Intensive personal transformation sessions', icon: 'Zap' },
        { name: 'Group Mastermind', description: 'Collaborative growth with like-minded achievers', icon: 'Users' },
        { name: 'VIP Intensive', description: 'Full-day deep-dive transformation experience', icon: 'Star' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'In 3 months, I went from stuck to unstoppable. This coaching changed everything.', author: 'James K.', role: 'Entrepreneur' },
        { quote: 'I doubled my income and found my purpose. Best investment I\'ve ever made.', author: 'Lisa M.', role: 'Executive' }
      ]),
      ProcessBlock.numbered([
        { title: 'Discovery Call', description: 'Free 30-minute consultation to explore your goals' },
        { title: 'Strategy Session', description: 'Deep dive into your vision and create your roadmap' },
        { title: 'Implementation', description: 'Weekly coaching to drive transformation and results' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Ready to Transform?',
        services: ['1:1 Breakthrough Coaching', 'Group Mastermind', 'VIP Intensive']
      }),
      CTABlock.primary({
        headline: 'Your Breakthrough Is Waiting',
        subheadline: 'Don\'t let another day pass feeling unfulfilled.',
        cta_text: 'Book Your Free Call',
        cta_link: '#booking'
      })
    ]
  },

  {
    id: 'coach_professional_executive',
    name: 'Executive Coach',
    description: 'Sophisticated design with royal blue and gold',
    vertical: 'coach',
    template_type: 'homepage',
    keywords: ['executive', 'leadership', 'corporate', 'business', 'professional'],
    theme: {
      primary_color: '#1E40AF',
      secondary_color: '#D4AF37',
      accent_color: '#1F2937',
      font_heading: 'DM Serif Display',
      font_body: 'Open Sans',
      font_family: 'DM Serif Display, serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Executive Edge',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Approach', anchor: '#process' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Schedule Consultation', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Executive Coaching',
        tagline: 'Elevate Your Leadership. Accelerate Your Impact.',
        cta: 'Schedule Consultation'
      }),
      StatsBlock.horizontal([
        { value: '500+', label: 'Executives Coached' },
        { value: 'Fortune 500', label: 'Client Base' },
        { value: 'ICF PCC', label: 'Certified' }
      ]),
      AboutBlock.withImage({
        title: 'Leadership Excellence',
        content: 'With 20+ years of executive experience and ICF certification, I help senior leaders navigate complexity, build high-performing teams, and drive strategic results.'
      }),
      ServicesBlock.list([
        { name: 'Executive Coaching', description: 'Confidential 1:1 coaching for C-suite and senior leaders', price: 'Starting $500/session' },
        { name: 'Leadership Development', description: 'Custom programs for emerging leaders and high-potentials', price: 'Custom pricing' },
        { name: 'Team Alignment', description: 'Strategic offsites and team coaching engagements', price: 'Custom pricing' }
      ]),
      ProcessBlock.numbered([
        { title: 'Assessment', description: 'Comprehensive leadership assessment and 360 feedback' },
        { title: 'Strategy', description: 'Define goals and create development roadmap' },
        { title: 'Coaching', description: 'Regular sessions focused on your priorities' },
        { title: 'Integration', description: 'Embed new behaviors and measure impact' }
      ]),
      FeaturesBlock.grid([
        { title: 'Confidential', description: 'Executive privilege ensured', icon: 'Lock' },
        { title: 'Evidence-Based', description: 'Research-backed methodologies', icon: 'BarChart' },
        { title: 'Global Experience', description: 'Worked across 30+ countries', icon: 'Globe' }
      ]),
      ContactFormBlock.standard({
        title: 'Start the Conversation',
        email: 'contact@executiveedge.com'
      })
    ]
  },

  {
    id: 'coach_wellness_mindfulness',
    name: 'Wellness & Mindfulness',
    description: 'Serene design with emerald and cyan tones',
    vertical: 'coach',
    template_type: 'homepage',
    keywords: ['wellness', 'mindfulness', 'meditation', 'holistic', 'balance', 'stress'],
    theme: {
      primary_color: '#059669',
      secondary_color: '#06B6D4',
      accent_color: '#F0FDF4',
      font_heading: 'Quicksand',
      font_body: 'Lato',
      font_family: 'Quicksand, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Mindful Living',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Programs', anchor: '#services' },
          { label: 'Testimonials', anchor: '#testimonials' },
          { label: 'Connect', anchor: '#contact' }
        ],
        cta_button: { text: 'Find Your Balance', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Mindful Living Coaching',
        tagline: 'Find Peace. Build Resilience. Live Fully.',
        cta: 'Begin Your Journey'
      }),
      AboutBlock.withImage({
        title: 'Your Guide to Inner Peace',
        content: 'As a certified mindfulness coach and meditation teacher, I help busy professionals reduce stress, increase focus, and cultivate lasting well-being through science-backed practices.'
      }),
      ServicesBlock.grid([
        { name: 'Mindfulness Coaching', description: 'Personal guidance to develop a sustainable practice', icon: 'Leaf' },
        { name: 'Stress Management', description: 'Tools and techniques for modern life balance', icon: 'Feather' },
        { name: 'Corporate Wellness', description: 'Bring mindfulness to your organization', icon: 'Building' },
        { name: 'Meditation Training', description: 'Learn to meditate with expert guidance', icon: 'Moon' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Finally learned to quiet my mind. My productivity and peace have both increased.', author: 'Emily R.', role: 'Tech Executive' },
        { quote: 'The stress management tools transformed my daily life. I feel like myself again.', author: 'David L.', role: 'Entrepreneur' }
      ]),
      PricingBlock.simple([
        { name: 'Discovery Session', price: '$0', features: ['30-minute call', 'Assess your needs', 'Get personalized recommendations'] },
        { name: '8-Week Program', price: '$1,200', features: ['Weekly coaching sessions', 'Meditation resources', 'Daily check-ins', 'Lifetime tools'], popular: true }
      ]),
      ProcessBlock.numbered([
        { title: 'Discovery Call', description: 'Connect and discuss your wellness goals' },
        { title: 'Strategy Session', description: 'Create your personalized mindfulness plan' },
        { title: 'Implementation', description: 'Weekly sessions to build sustainable practices' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Start Your Mindfulness Journey',
        services: ['Mindfulness Coaching', 'Stress Management', 'Meditation Training']
      }),
      ContactFormBlock.standard({
        title: 'Questions? Let\'s Connect',
        email: 'hello@mindfulliving.com'
      })
    ]
  },

  {
    id: 'coach_career_transition',
    name: 'Career Transition',
    description: 'Dynamic design with indigo and violet tones',
    vertical: 'coach',
    template_type: 'homepage',
    keywords: ['career', 'transition', 'job', 'pivot', 'change', 'professional'],
    theme: {
      primary_color: '#4F46E5',
      secondary_color: '#8B5CF6',
      accent_color: '#FBBF24',
      font_heading: 'Manrope',
      font_body: 'Inter',
      font_family: 'Manrope, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Career Catalyst',
        menu_items: [
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Success Stories', anchor: '#testimonials' },
          { label: 'Get Started', anchor: '#booking' }
        ],
        cta_button: { text: 'Free Strategy Call', link: '#booking' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Career Catalyst Coaching',
        tagline: 'Navigate Your Career Change with Confidence',
        cta: 'Book Free Strategy Call'
      }),
      StatsBlock.horizontal([
        { value: '300+', label: 'Career Pivots' },
        { value: '85%', label: 'Land Within 90 Days' },
        { value: '$30K+', label: 'Avg Salary Increase' }
      ]),
      AboutBlock.withImage({
        title: 'Expert Career Navigation',
        content: 'After 15 years in HR leadership at Fortune 500 companies, I now help professionals like you make strategic career moves that align with your values and maximize your potential.'
      }),
      ServicesBlock.grid([
        { name: 'Career Clarity', description: 'Discover your ideal next role and industry', icon: 'Compass' },
        { name: 'Job Search Strategy', description: 'Optimize your search and land interviews', icon: 'Target' },
        { name: 'Interview Mastery', description: 'Prepare and perform with confidence', icon: 'MessageSquare' },
        { name: 'Salary Negotiation', description: 'Get the compensation you deserve', icon: 'TrendingUp' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Pivoted from finance to tech PM and got a 40% raise. The strategy and confidence I gained was invaluable.', author: 'Amanda T.', role: 'Product Manager' },
        { quote: 'After 20 years in corporate, I thought starting over would be impossible. Within 8 weeks, I had my dream role.', author: 'Robert K.', role: 'Director of Operations' }
      ]),
      ProcessBlock.numbered([
        { title: 'Discovery Call', description: 'Free consultation to assess your career goals' },
        { title: 'Strategy Session', description: 'Build your personalized career transition roadmap' },
        { title: 'Implementation', description: 'Weekly coaching to execute your plan and land your dream role' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Start Your Career Transformation',
        services: ['Career Clarity', 'Job Search Strategy', 'Interview Mastery']
      }),
      CTABlock.primary({
        headline: 'Ready for Your Next Chapter?',
        subheadline: 'Your ideal career is waiting. Let\'s find it together.',
        cta_text: 'Book Free Call',
        cta_link: '#booking'
      })
    ]
  }
];

// =============================================
// CONSULTANT TEMPLATES (4)
// Professional, corporate, trustworthy
// =============================================

export const ConsultantTemplates: WebsiteTemplate[] = [
  {
    id: 'consultant_professional_services',
    name: 'Professional Services',
    description: 'Sleek corporate design with dark slate and blue',
    vertical: 'consultant',
    template_type: 'homepage',
    keywords: ['consulting', 'professional', 'business', 'strategy', 'advisory'],
    theme: {
      primary_color: '#0F172A',
      secondary_color: '#3B82F6',
      accent_color: '#F1F5F9',
      font_heading: 'Inter',
      font_body: 'Inter',
      font_family: 'Inter, sans-serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Strategic Advisors',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Results', anchor: '#stats' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Get Started', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Strategic Advisory',
        tagline: 'Strategic Insights. Tangible Results.',
        cta: 'Schedule Consultation'
      }),
      ServicesBlock.list([
        { name: 'Strategic Planning', description: 'Define your vision and create actionable roadmaps for growth', icon: 'Map' },
        { name: 'Operations Excellence', description: 'Optimize processes and drive operational efficiency', icon: 'Settings' },
        { name: 'Digital Transformation', description: 'Modernize your business with technology-driven solutions', icon: 'Laptop' },
        { name: 'Change Management', description: 'Navigate organizational change with minimal disruption', icon: 'RefreshCw' }
      ]),
      StatsBlock.horizontal([
        { value: '$50M+', label: 'Client Value Created' },
        { value: '150+', label: 'Projects Delivered' },
        { value: '20+', label: 'Years Experience' }
      ]),
      AboutBlock.withImage({
        title: 'Your Strategic Partner',
        content: 'We combine deep industry expertise with practical experience to help organizations achieve their most ambitious goals. Our approach is collaborative, data-driven, and focused on sustainable results.'
      }),
      FeaturesBlock.grid([
        { title: 'Industry Expertise', description: 'Deep knowledge across sectors', icon: 'Briefcase' },
        { title: 'Data-Driven', description: 'Decisions backed by analytics', icon: 'BarChart2' },
        { title: 'Implementation Focus', description: 'From strategy to execution', icon: 'CheckCircle' },
        { title: 'Measurable ROI', description: 'Track and prove results', icon: 'TrendingUp' }
      ]),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Free discovery call to understand your challenges' },
        { title: 'Assessment', description: 'Comprehensive analysis of your current state' },
        { title: 'Strategy & Implementation', description: 'Develop and execute your roadmap to success' }
      ]),
      ContactFormBlock.standard({
        title: 'Let\'s Discuss Your Challenges',
        email: 'inquiries@strategicadvisors.com'
      })
    ]
  },

  {
    id: 'consultant_tech_advisory',
    name: 'Technology Advisory',
    description: 'Modern tech-forward design with purple and cyan',
    vertical: 'consultant',
    template_type: 'homepage',
    keywords: ['technology', 'IT', 'digital', 'software', 'tech', 'CTO'],
    theme: {
      primary_color: '#7C3AED',
      secondary_color: '#06B6D4',
      accent_color: '#F5F3FF',
      font_heading: 'Space Grotesk',
      font_body: 'Inter',
      font_family: 'Space Grotesk, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'TechForward',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Case Studies', anchor: '#testimonials' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Free Assessment', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.professional({
        name: 'Technology Advisory',
        tagline: 'Transform Your Business with Technology',
        cta: 'Get Free Assessment'
      }),
      ServicesBlock.grid([
        { name: 'CTO Advisory', description: 'Strategic technology leadership for growing companies', icon: 'Code' },
        { name: 'Architecture Review', description: 'Assess and optimize your technical infrastructure', icon: 'Server' },
        { name: 'Team Building', description: 'Build and scale high-performing engineering teams', icon: 'Users' },
        { name: 'Vendor Selection', description: 'Make informed technology and partner decisions', icon: 'CheckSquare' }
      ]),
      StatsBlock.horizontal([
        { value: '100+', label: 'Tech Transformations' },
        { value: '$20M+', label: 'Funding Secured' },
        { value: '3x', label: 'Avg Team Efficiency Gain' }
      ]),
      AboutBlock.withImage({
        title: 'Technology Leadership',
        content: 'Former CTO with experience scaling startups from seed to IPO. I help companies make smart technology decisions, build world-class teams, and accelerate their digital transformation.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Helped us completely restructure our architecture and save $500K annually in cloud costs.', author: 'Sarah Chen', role: 'CEO, FinTech Startup' },
        { quote: 'The best investment we made. Our engineering velocity tripled within 6 months.', author: 'Michael Park', role: 'Founder, SaaS Company' }
      ]),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Free technology assessment and needs analysis' },
        { title: 'Assessment', description: 'Deep dive into your tech stack and processes' },
        { title: 'Strategy & Implementation', description: 'Build and execute your technology roadmap' }
      ]),
      ContactFormBlock.standard({
        title: 'Let\'s Talk Tech',
        email: 'hello@techforward.com'
      })
    ]
  },

  {
    id: 'consultant_marketing_agency',
    name: 'Marketing Consultant',
    description: 'Creative, vibrant design with pink and purple',
    vertical: 'consultant',
    template_type: 'homepage',
    keywords: ['marketing', 'branding', 'digital marketing', 'creative', 'growth'],
    theme: {
      primary_color: '#EC4899',
      secondary_color: '#8B5CF6',
      accent_color: '#FDF4FF',
      font_heading: 'Poppins',
      font_body: 'Open Sans',
      font_family: 'Poppins, sans-serif',
      brand_voice: 'creative'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'GrowthLab',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Results', anchor: '#stats' },
          { label: 'Start Project', anchor: '#contact' }
        ],
        cta_button: { text: 'Get Proposal', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Growth Marketing',
        tagline: 'Brands That Stand Out. Results That Speak.',
        cta: 'Let\'s Create Together'
      }),
      ServicesBlock.grid([
        { name: 'Brand Strategy', description: 'Define your unique voice and visual identity', icon: 'Palette' },
        { name: 'Digital Marketing', description: 'SEO, PPC, and social that drives results', icon: 'TrendingUp' },
        { name: 'Content Creation', description: 'Compelling content that engages and converts', icon: 'Edit' },
        { name: 'Growth Strategy', description: 'Data-driven strategies for sustainable growth', icon: 'Rocket' }
      ]),
      StatsBlock.horizontal([
        { value: '300%', label: 'Avg ROI' },
        { value: '50+', label: 'Brands Launched' },
        { value: '10M+', label: 'Leads Generated' }
      ]),
      AboutBlock.withImage({
        title: 'Creative Meets Performance',
        content: 'I blend creative excellence with data-driven strategy to build brands that not only look amazing but deliver measurable business results. Let\'s make marketing that works.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Our rebrand increased conversion by 150%. The ROI was immediate and incredible.', author: 'Jennifer Wu', role: 'E-commerce Founder' },
        { quote: 'Finally, a marketing partner who understands both creativity and numbers.', author: 'Alex Rivera', role: 'SaaS CEO' }
      ]),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Free discovery call to discuss your goals' },
        { title: 'Assessment', description: 'Analyze your current marketing and brand position' },
        { title: 'Strategy & Implementation', description: 'Create and execute your growth roadmap' }
      ]),
      ContactFormBlock.standard({
        title: 'Start Your Project',
        email: 'create@growthlab.com'
      })
    ]
  },

  {
    id: 'consultant_financial_advisory',
    name: 'Financial Advisory',
    description: 'Trust-building design with deep green and gold',
    vertical: 'consultant',
    template_type: 'homepage',
    keywords: ['financial', 'CFO', 'finance', 'accounting', 'investment', 'advisory'],
    theme: {
      primary_color: '#064E3B',
      secondary_color: '#D4AF37',
      accent_color: '#F0FDF4',
      font_heading: 'Merriweather',
      font_body: 'Lato',
      font_family: 'Merriweather, serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Financial Partners',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Expertise', anchor: '#features' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Free Consultation', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Financial Advisory',
        tagline: 'Strategic Financial Guidance for Business Growth',
        cta: 'Schedule Free Consultation'
      }),
      ServicesBlock.list([
        { name: 'Fractional CFO', description: 'Executive-level financial leadership without the full-time cost', icon: 'Briefcase' },
        { name: 'Financial Planning', description: 'Comprehensive planning for business growth and exit', icon: 'LineChart' },
        { name: 'M&A Advisory', description: 'Strategic guidance through mergers and acquisitions', icon: 'GitMerge' },
        { name: 'Fundraising Support', description: 'Prepare and position your company for investment', icon: 'DollarSign' }
      ]),
      StatsBlock.horizontal([
        { value: '$500M+', label: 'Transactions Advised' },
        { value: '200+', label: 'Companies Served' },
        { value: '25+', label: 'Years Experience' }
      ]),
      AboutBlock.withImage({
        title: 'Trusted Financial Leadership',
        content: 'Former CFO of public and private companies with deep expertise in growth strategy, fundraising, and M&A. I provide the financial leadership you need at every stage of your company\'s journey.'
      }),
      FeaturesBlock.grid([
        { title: 'CPA & MBA', description: 'Advanced credentials you can trust', icon: 'Award' },
        { title: 'Board Experience', description: 'Strategic perspective from the top', icon: 'Users' },
        { title: 'Industry Expertise', description: 'Tech, healthcare, manufacturing', icon: 'Building' },
        { title: 'Confidential', description: 'Your information is protected', icon: 'Shield' }
      ]),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Free financial consultation to assess your needs' },
        { title: 'Assessment', description: 'Comprehensive analysis of your financial situation' },
        { title: 'Strategy & Implementation', description: 'Develop and execute your financial roadmap' }
      ]),
      ContactFormBlock.standard({
        title: 'Let\'s Discuss Your Financials',
        email: 'contact@financialpartners.com'
      })
    ]
  }
];

// =============================================
// LAWYER TEMPLATES (4)
// Authoritative, classic, trustworthy
// =============================================

export const LawyerTemplates: WebsiteTemplate[] = [
  {
    id: 'lawyer_professional_firm',
    name: 'Professional Law Firm',
    description: 'Prestigious design with navy and gold',
    vertical: 'lawyer',
    template_type: 'homepage',
    keywords: ['law firm', 'attorney', 'legal', 'professional', 'corporate'],
    theme: {
      primary_color: '#1A1F2E',
      secondary_color: '#C9A962',
      accent_color: '#F8F6F3',
      font_heading: 'Playfair Display',
      font_body: 'Source Sans Pro',
      font_family: 'Playfair Display, serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Morrison & Associates',
        menu_items: [
          { label: 'Practice Areas', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Team', anchor: '#team' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Free Consultation', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Morrison & Associates',
        tagline: 'Excellence in Legal Representation Since 1985',
        cta: 'Request Free Consultation'
      }),
      StatsBlock.horizontal([
        { value: '35+', label: 'Years Experience' },
        { value: '5,000+', label: 'Cases Won' },
        { value: '$500M+', label: 'Client Recoveries' }
      ]),
      ServicesBlock.list([
        { name: 'Corporate Law', description: 'Business formation, contracts, M&A, and corporate governance', icon: 'Building' },
        { name: 'Litigation', description: 'Skilled trial advocacy and dispute resolution', icon: 'Scale' },
        { name: 'Real Estate', description: 'Commercial and residential transactions and disputes', icon: 'Home' },
        { name: 'Estate Planning', description: 'Wills, trusts, and comprehensive estate administration', icon: 'FileText' }
      ]),
      AboutBlock.withImage({
        title: 'Trusted Legal Counsel',
        content: 'For nearly four decades, Morrison & Associates has provided exceptional legal representation to individuals and businesses throughout the region. Our commitment to excellence and client service sets us apart.'
      }),
      FeaturesBlock.grid([
        { title: 'AV Rated', description: 'Highest peer rating for ethics and ability', icon: 'Award' },
        { title: 'Super Lawyers', description: 'Multiple attorneys recognized annually', icon: 'Star' },
        { title: 'Personal Attention', description: 'Direct partner involvement in every case', icon: 'Users' }
      ]),
      ProcessBlock.numbered([
        { title: 'Free Consultation', description: 'Discuss your legal matter with an experienced attorney' },
        { title: 'Case Review', description: 'We evaluate your case and develop a legal strategy' },
        { title: 'Legal Action & Representation', description: 'We fight for your rights and best outcome' }
      ]),
      ContactFormBlock.standard({
        title: 'Schedule Your Consultation',
        email: 'info@morrisonlaw.com'
      })
    ]
  },

  {
    id: 'lawyer_personal_injury',
    name: 'Personal Injury Specialist',
    description: 'Bold, action-oriented design with deep red',
    vertical: 'lawyer',
    template_type: 'homepage',
    keywords: ['personal injury', 'accident', 'injury lawyer', 'car accident', 'compensation'],
    theme: {
      primary_color: '#8B1A1A',
      secondary_color: '#1A1A2E',
      accent_color: '#D4AF37',
      font_heading: 'Oswald',
      font_body: 'Inter',
      font_family: 'Oswald, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'JUSTICE ADVOCATES',
        menu_items: [
          { label: 'Cases', anchor: '#services' },
          { label: 'Results', anchor: '#stats' },
          { label: 'About', anchor: '#about' },
          { label: 'Free Case Review', anchor: '#contact' }
        ],
        cta_button: { text: 'Free Case Review', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Justice Advocates',
        tagline: 'Injured? We Fight for Maximum Compensation.',
        cta: 'Get Your Free Case Review'
      }),
      StatsBlock.horizontal([
        { value: '$100M+', label: 'Won for Clients' },
        { value: '98%', label: 'Success Rate' },
        { value: 'No Fee', label: 'Unless We Win' }
      ]),
      ServicesBlock.grid([
        { name: 'Car Accidents', description: 'Aggressive representation for auto injury victims', icon: 'Car' },
        { name: 'Truck Accidents', description: 'Taking on big trucking companies and insurers', icon: 'Truck' },
        { name: 'Medical Malpractice', description: 'Holding negligent healthcare providers accountable', icon: 'Activity' },
        { name: 'Workplace Injuries', description: 'Workers\' comp and third-party claims', icon: 'HardHat' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'They got me $450,000 when the insurance company offered $15,000. Life-changing.', author: 'Marcus J.', role: 'Car Accident Victim' },
        { quote: 'After my surgery went wrong, they fought the hospital and won. Real justice.', author: 'Patricia S.', role: 'Medical Malpractice Client' }
      ]),
      AboutBlock.withImage({
        title: 'We Don\'t Back Down',
        content: 'Insurance companies have teams of lawyers. You deserve one too. Our firm has recovered over $100 million for injury victims, and we never charge a fee unless we win your case.'
      }),
      ProcessBlock.numbered([
        { title: 'Free Consultation', description: 'No-obligation case review with our injury lawyers' },
        { title: 'Case Review', description: 'We investigate and build your strongest case' },
        { title: 'Legal Action & Representation', description: 'We fight for maximum compensation - no fee unless we win' }
      ]),
      CTABlock.primary({
        headline: 'Don\'t Wait. Evidence Disappears.',
        subheadline: 'Call now for your FREE case evaluation. We come to you.',
        cta_text: 'Get Free Case Review',
        cta_link: '#contact'
      }),
      ContactFormBlock.standard({
        title: 'Free Case Evaluation',
        email: 'cases@justiceadvocates.com'
      })
    ]
  },

  {
    id: 'lawyer_family_law',
    name: 'Family Law Practice',
    description: 'Approachable yet professional with steel blue',
    vertical: 'lawyer',
    template_type: 'homepage',
    keywords: ['family law', 'divorce', 'custody', 'child support', 'family attorney'],
    theme: {
      primary_color: '#3D4A5D',
      secondary_color: '#7A8B99',
      accent_color: '#C7A17A',
      font_heading: 'Cormorant Garamond',
      font_body: 'Raleway',
      font_family: 'Cormorant Garamond, serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Hartley Family Law',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Process', anchor: '#process' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Confidential Consult', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Hartley Family Law',
        tagline: 'Compassionate Guidance Through Family Transitions',
        cta: 'Schedule Confidential Consultation'
      }),
      AboutBlock.withImage({
        title: 'Your Family Comes First',
        content: 'Family legal matters are deeply personal. I provide compassionate, skilled representation while protecting your interests and helping you move forward. Every family deserves to be heard.'
      }),
      ServicesBlock.grid([
        { name: 'Divorce', description: 'Contested and uncontested divorce representation', icon: 'Split' },
        { name: 'Child Custody', description: 'Protecting your parental rights and children\'s wellbeing', icon: 'Users' },
        { name: 'Child Support', description: 'Establishing fair support arrangements', icon: 'DollarSign' },
        { name: 'Mediation', description: 'Collaborative resolution when possible', icon: 'MessageCircle' }
      ]),
      ProcessBlock.numbered([
        { title: 'Initial Consultation', description: 'Understand your situation and explore options' },
        { title: 'Strategy Development', description: 'Create a plan tailored to your family\'s needs' },
        { title: 'Representation', description: 'Skilled advocacy in negotiations and court' },
        { title: 'Resolution', description: 'Achieve the best possible outcome for your family' }
      ]),
      FeaturesBlock.grid([
        { title: 'Child-Focused', description: 'Children\'s wellbeing guides our approach', icon: 'Heart' },
        { title: 'Collaborative Options', description: 'Mediation and settlement when beneficial', icon: 'Handshake' },
        { title: 'Confidential', description: 'Your privacy is protected', icon: 'Lock' }
      ]),
      ContactFormBlock.standard({
        title: 'Take the First Step',
        email: 'info@hartleyfamilylaw.com'
      })
    ]
  },

  {
    id: 'lawyer_criminal_defense',
    name: 'Criminal Defense',
    description: 'Bold, dark design with black and crimson',
    vertical: 'lawyer',
    template_type: 'homepage',
    keywords: ['criminal defense', 'DUI', 'felony', 'misdemeanor', 'defense attorney'],
    theme: {
      primary_color: '#0D0D0D',
      secondary_color: '#B91C1C',
      accent_color: '#FAFAFA',
      font_heading: 'Bebas Neue',
      font_body: 'Roboto',
      font_family: 'Bebas Neue, sans-serif',
      brand_voice: 'bold',
      background_color: '#0D0D0D',
      text_color: '#FAFAFA'
    },
    blocks: [
      HeaderBlock.dark({
        logo_text: 'SHIELD DEFENSE',
        menu_items: [
          { label: 'Cases', anchor: '#services' },
          { label: 'Results', anchor: '#stats' },
          { label: 'About', anchor: '#about' },
          { label: '24/7 Help', anchor: '#contact' }
        ],
        cta_button: { text: 'Call Now 24/7', link: 'tel:+1234567890' }
      }),
      HeroBlock.professional({
        name: 'Shield Defense',
        tagline: 'ARRESTED? TIME IS CRITICAL. CALL NOW.',
        cta: 'Get Immediate Help'
      }),
      StatsBlock.horizontal([
        { value: '2,000+', label: 'Cases Defended' },
        { value: '85%', label: 'Charges Reduced/Dismissed' },
        { value: '24/7', label: 'Available' }
      ]),
      ServicesBlock.grid([
        { name: 'DUI Defense', description: 'Fight your DUI charges aggressively', icon: 'AlertTriangle' },
        { name: 'Drug Offenses', description: 'Possession, distribution, trafficking defense', icon: 'Shield' },
        { name: 'Violent Crimes', description: 'Assault, battery, domestic violence', icon: 'AlertOctagon' },
        { name: 'White Collar', description: 'Fraud, embezzlement, federal charges', icon: 'Briefcase' }
      ]),
      AboutBlock.withImage({
        title: 'Former Prosecutor. Now Your Defender.',
        content: 'I spent 10 years as a prosecutor. Now I use that insider knowledge to defend you. I know how they build cases—and I know how to break them apart. Your future is worth fighting for.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Facing 5 years. Got probation. He knew exactly how to fight the charges.', author: 'Anonymous', role: 'DUI Client' },
        { quote: 'All charges dismissed. Worth every penny. Call him immediately if you\'re in trouble.', author: 'Anonymous', role: 'Drug Offense Client' }
      ]),
      ProcessBlock.numbered([
        { title: 'Free Consultation', description: 'Call 24/7 for immediate confidential consultation' },
        { title: 'Case Review', description: 'Thorough analysis of charges and evidence against you' },
        { title: 'Legal Action & Representation', description: 'Aggressive defense to protect your rights and freedom' }
      ]),
      CTABlock.primary({
        headline: 'Every Minute Counts',
        subheadline: 'The prosecution is already building their case. You need a defender NOW.',
        cta_text: 'Call 24/7 Hotline',
        cta_link: 'tel:+1234567890'
      }),
      ContactFormBlock.standard({
        title: 'Confidential Case Review',
        email: 'defense@shielddefense.com'
      })
    ]
  }
];

// =============================================
// PHOTOGRAPHER TEMPLATES (4)
// Minimal, image-focused, portfolio style
// =============================================

export const PhotographerTemplates: WebsiteTemplate[] = [
  {
    id: 'photographer_portfolio_minimal',
    name: 'Minimal Portfolio',
    description: 'Ultra-clean dark design letting images shine',
    vertical: 'photographer',
    template_type: 'homepage',
    keywords: ['portfolio', 'minimal', 'photography', 'fine art', 'contemporary'],
    theme: {
      primary_color: '#0A0A0A',
      secondary_color: '#FAFAFA',
      accent_color: '#E5E5E5',
      font_heading: 'Space Grotesk',
      font_body: 'Inter',
      font_family: 'Space Grotesk, sans-serif',
      brand_voice: 'minimal',
      background_color: '#0A0A0A',
      text_color: '#FAFAFA'
    },
    blocks: [
      HeaderBlock.dark({
        logo_text: 'STUDIO',
        menu_items: [
          { label: 'Portfolio', anchor: '#gallery' },
          { label: 'About', anchor: '#about' },
          { label: 'Services', anchor: '#services' },
          { label: 'Contact', anchor: '#contact' }
        ]
      }),
      HeroBlock.minimal({
        name: 'Visual Studio',
        tagline: 'Capturing Light. Creating Art.',
        cta: 'View Portfolio'
      }),
      GalleryBlock.masonry([
        { url: '/placeholder-1.jpg', alt: 'Portfolio image 1' },
        { url: '/placeholder-2.jpg', alt: 'Portfolio image 2' },
        { url: '/placeholder-3.jpg', alt: 'Portfolio image 3' },
        { url: '/placeholder-4.jpg', alt: 'Portfolio image 4' },
        { url: '/placeholder-5.jpg', alt: 'Portfolio image 5' },
        { url: '/placeholder-6.jpg', alt: 'Portfolio image 6' }
      ]),
      AboutBlock.textOnly({
        title: 'About',
        content: 'Award-winning photographer specializing in fine art and commercial work. Based in New York, available worldwide.'
      }),
      ServicesBlock.list([
        { name: 'Editorial', description: 'Magazine and publication photography' },
        { name: 'Commercial', description: 'Brand and advertising campaigns' },
        { name: 'Fine Art', description: 'Limited edition prints and exhibitions' }
      ]),
      ProcessBlock.numbered([
        { title: 'Inquiry', description: 'Send inquiry with your vision and dates' },
        { title: 'Consultation & Planning', description: 'Discuss your project and create the plan' },
        { title: 'Photo Session & Delivery', description: 'Capture stunning images and deliver final gallery' }
      ]),
      ContactFormBlock.standard({
        title: 'Get in Touch',
        email: 'studio@photographer.com'
      })
    ]
  },

  {
    id: 'photographer_wedding',
    name: 'Wedding Photography',
    description: 'Elegant, romantic design with warm taupe',
    vertical: 'photographer',
    template_type: 'homepage',
    keywords: ['wedding', 'engagement', 'couples', 'romantic', 'elegant'],
    theme: {
      primary_color: '#8B7355',
      secondary_color: '#F5F0E8',
      accent_color: '#D4A574',
      font_heading: 'Cormorant Garamond',
      font_body: 'Lato',
      font_family: 'Cormorant Garamond, serif',
      brand_voice: 'elegant'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Anna Rose Photography',
        menu_items: [
          { label: 'Portfolio', anchor: '#gallery' },
          { label: 'About', anchor: '#about' },
          { label: 'Investment', anchor: '#pricing' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Inquire', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Anna Rose Photography',
        tagline: 'Timeless Wedding Photography',
        cta: 'View Galleries'
      }),
      GalleryBlock.grid([
        { url: '/wedding-1.jpg', alt: 'Wedding photo 1' },
        { url: '/wedding-2.jpg', alt: 'Wedding photo 2' },
        { url: '/wedding-3.jpg', alt: 'Wedding photo 3' },
        { url: '/wedding-4.jpg', alt: 'Wedding photo 4' }
      ]),
      AboutBlock.withImage({
        title: 'Hello, I\'m Anna',
        content: 'I believe your wedding photos should feel like the most beautiful version of your love story. My approach is documentary with a fine art sensibility—capturing real moments with timeless elegance.'
      }),
      ServicesBlock.grid([
        { name: 'Full Day Coverage', description: '8+ hours of photography from prep to party', icon: 'Camera' },
        { name: 'Engagement Session', description: 'Relaxed couples session before the big day', icon: 'Heart' },
        { name: 'Albums & Prints', description: 'Heirloom-quality albums and fine art prints', icon: 'Book' }
      ]),
      PricingBlock.simple([
        { name: 'Essentials', price: '$4,500', features: ['6 hours coverage', 'Online gallery', '500+ edited images', 'Print rights'] },
        { name: 'Signature', price: '$6,500', features: ['10 hours coverage', 'Second photographer', 'Engagement session', 'Custom album', 'Print rights'], popular: true },
        { name: 'Luxe', price: '$9,000', features: ['Full day coverage', 'Second photographer', 'Engagement session', 'Rehearsal dinner', 'Premium album', 'Wall art credit'] }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Anna captured moments we didn\'t even know were happening. We cry every time we look at our album.', author: 'Sarah & Michael', role: 'Married 2024' },
        { quote: 'Felt like a friend was photographing us, but with magazine-quality results.', author: 'Jessica & David', role: 'Married 2023' }
      ]),
      ProcessBlock.numbered([
        { title: 'Inquiry', description: 'Share your wedding date and vision' },
        { title: 'Consultation & Planning', description: 'Meet to discuss your day and create your timeline' },
        { title: 'Photo Session & Delivery', description: 'Capture your story and deliver your beautiful gallery' }
      ]),
      ContactFormBlock.standard({
        title: 'Let\'s Connect',
        email: 'hello@annarosephoto.com'
      })
    ]
  },

  {
    id: 'photographer_commercial',
    name: 'Commercial Photography',
    description: 'Bold, professional design with slate and orange',
    vertical: 'photographer',
    template_type: 'homepage',
    keywords: ['commercial', 'product', 'advertising', 'brand', 'corporate'],
    theme: {
      primary_color: '#1E293B',
      secondary_color: '#F97316',
      accent_color: '#0EA5E9',
      font_heading: 'Montserrat',
      font_body: 'Open Sans',
      font_family: 'Montserrat, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'FRAME STUDIOS',
        menu_items: [
          { label: 'Work', anchor: '#gallery' },
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Get Quote', anchor: '#contact' }
        ],
        cta_button: { text: 'Get Quote', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Frame Studios',
        tagline: 'Commercial Photography That Sells',
        cta: 'View Our Work'
      }),
      GalleryBlock.grid([
        { url: '/commercial-1.jpg', alt: 'Product photography' },
        { url: '/commercial-2.jpg', alt: 'Brand campaign' },
        { url: '/commercial-3.jpg', alt: 'Food photography' },
        { url: '/commercial-4.jpg', alt: 'Corporate headshots' }
      ]),
      ServicesBlock.grid([
        { name: 'Product Photography', description: 'E-commerce, catalog, and lifestyle product shots', icon: 'Package' },
        { name: 'Brand Campaigns', description: 'Cohesive visual storytelling for your brand', icon: 'Palette' },
        { name: 'Food & Beverage', description: 'Mouthwatering imagery that drives sales', icon: 'Coffee' },
        { name: 'Corporate', description: 'Headshots, team photos, and corporate events', icon: 'Users' }
      ]),
      StatsBlock.horizontal([
        { value: '500+', label: 'Brands Served' },
        { value: '50K+', label: 'Images Delivered' },
        { value: '10+', label: 'Years Experience' }
      ]),
      AboutBlock.withImage({
        title: 'Results-Driven Visuals',
        content: 'We\'ve helped brands from startups to Fortune 500 companies create images that convert browsers into buyers. Our studio combines creative vision with commercial expertise.'
      }),
      ProcessBlock.numbered([
        { title: 'Inquiry', description: 'Tell us about your project and vision' },
        { title: 'Consultation & Planning', description: 'Develop creative concepts and production plan' },
        { title: 'Photo Session & Delivery', description: 'Professional shoot and polished final images' }
      ]),
      ContactFormBlock.standard({
        title: 'Request a Quote',
        email: 'projects@framestudios.com'
      })
    ]
  },

  {
    id: 'photographer_portrait',
    name: 'Portrait Photography',
    description: 'Warm, inviting design with champagne tones',
    vertical: 'photographer',
    template_type: 'homepage',
    keywords: ['portrait', 'headshots', 'family', 'professional', 'personal branding'],
    theme: {
      primary_color: '#7C6F64',
      secondary_color: '#F5E6D3',
      accent_color: '#C9A87C',
      font_heading: 'Quicksand',
      font_body: 'Nunito',
      font_family: 'Quicksand, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Portrait Studio',
        menu_items: [
          { label: 'Gallery', anchor: '#gallery' },
          { label: 'Sessions', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Book', anchor: '#booking' }
        ],
        cta_button: { text: 'Book Session', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Portrait Studio',
        tagline: 'Portraits That Tell Your Story',
        cta: 'Book Your Session'
      }),
      GalleryBlock.grid([
        { url: '/portrait-1.jpg', alt: 'Professional headshot' },
        { url: '/portrait-2.jpg', alt: 'Family portrait' },
        { url: '/portrait-3.jpg', alt: 'Personal branding' },
        { url: '/portrait-4.jpg', alt: 'Senior portrait' }
      ]),
      ServicesBlock.grid([
        { name: 'Professional Headshots', description: 'LinkedIn, corporate, and acting headshots', icon: 'User' },
        { name: 'Personal Branding', description: 'A library of images for your business', icon: 'Star' },
        { name: 'Family Portraits', description: 'Timeless family memories', icon: 'Users' },
        { name: 'Senior Portraits', description: 'Celebrate this milestone in style', icon: 'GraduationCap' }
      ]),
      AboutBlock.withImage({
        title: 'Making You Look Your Best',
        content: 'I believe everyone deserves to see themselves beautifully. My relaxed approach helps you feel confident in front of the camera, resulting in natural, stunning portraits you\'ll treasure.'
      }),
      PricingBlock.simple([
        { name: 'Mini Session', price: '$295', features: ['30 minutes', '10 edited images', 'Online gallery', 'Print rights'] },
        { name: 'Standard', price: '$495', features: ['60 minutes', '25 edited images', 'Outfit change', 'Online gallery', 'Print rights'], popular: true },
        { name: 'Branding', price: '$1,200', features: ['2 hours', '50+ images', 'Multiple locations', 'Social media crops', 'Commercial rights'] }
      ]),
      ProcessBlock.numbered([
        { title: 'Inquiry', description: 'Choose your session type and preferred date' },
        { title: 'Consultation & Planning', description: 'Discuss your vision and prep for the session' },
        { title: 'Photo Session & Delivery', description: 'Relaxed shoot and receive your beautiful images' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Book Your Session',
        services: ['Professional Headshots', 'Personal Branding', 'Family Portraits']
      }),
      ContactFormBlock.standard({
        title: 'Questions?',
        email: 'hello@portraitstudio.com'
      })
    ]
  }
];

// =============================================
// REAL ESTATE TEMPLATES (4)
// Luxurious or friendly, property-focused
// =============================================

export const RealEstateTemplates: WebsiteTemplate[] = [
  {
    id: 'realtor_luxury',
    name: 'Luxury Real Estate',
    description: 'Prestigious dark design with gold accents',
    vertical: 'realtor',
    template_type: 'homepage',
    keywords: ['luxury', 'high-end', 'estate', 'premium', 'exclusive'],
    theme: {
      primary_color: '#1A1A1A',
      secondary_color: '#D4AF37',
      accent_color: '#F5F5F5',
      font_heading: 'Playfair Display',
      font_body: 'Lato',
      font_family: 'Playfair Display, serif',
      brand_voice: 'elegant',
      background_color: '#1A1A1A',
      text_color: '#F5F5F5'
    },
    blocks: [
      HeaderBlock.dark({
        logo_text: 'ESTATE LUXE',
        menu_items: [
          { label: 'Properties', anchor: '#gallery' },
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Private Consultation', link: '#contact' }
      }),
      HeroBlock.professional({
        name: 'Estate Luxe',
        tagline: 'Extraordinary Properties for Extraordinary Lives',
        cta: 'View Exclusive Listings'
      }),
      StatsBlock.horizontal([
        { value: '$2B+', label: 'In Sales' },
        { value: 'Top 1%', label: 'Nationwide' },
        { value: '20+', label: 'Years Experience' }
      ]),
      GalleryBlock.grid([
        { url: '/luxury-1.jpg', alt: 'Luxury estate' },
        { url: '/luxury-2.jpg', alt: 'Waterfront property' },
        { url: '/luxury-3.jpg', alt: 'Modern mansion' },
        { url: '/luxury-4.jpg', alt: 'Historic estate' }
      ]),
      ServicesBlock.list([
        { name: 'Luxury Sales', description: 'Discreet representation for discerning buyers and sellers' },
        { name: 'Off-Market Access', description: 'Exclusive properties never publicly listed' },
        { name: 'Global Network', description: 'International buyers through elite referral network' },
        { name: 'White Glove Service', description: 'Concierge support through every step' }
      ]),
      AboutBlock.withImage({
        title: 'Unparalleled Expertise',
        content: 'Ranked in the top 1% of agents nationwide, I specialize exclusively in luxury properties. My clients expect and receive an exceptional level of service, discretion, and market knowledge.'
      }),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Private meeting to understand your property needs' },
        { title: 'Property Search', description: 'Access exclusive listings matched to your criteria' },
        { title: 'Closing & Purchase', description: 'White-glove support through negotiation and closing' }
      ]),
      ContactFormBlock.standard({
        title: 'Private Consultation',
        email: 'contact@estateluxe.com'
      })
    ]
  },

  {
    id: 'realtor_family_homes',
    name: 'Family Homes Specialist',
    description: 'Friendly, approachable design with blue and green',
    vertical: 'realtor',
    template_type: 'homepage',
    keywords: ['family', 'homes', 'neighborhoods', 'schools', 'community'],
    theme: {
      primary_color: '#2563EB',
      secondary_color: '#22C55E',
      accent_color: '#F0F9FF',
      font_heading: 'Nunito',
      font_body: 'Open Sans',
      font_family: 'Nunito, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Home & Family Realty',
        menu_items: [
          { label: 'Listings', anchor: '#gallery' },
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Find Your Home', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Home & Family Realty',
        tagline: 'Find the Perfect Home for Your Family',
        cta: 'Start Your Search'
      }),
      StatsBlock.horizontal([
        { value: '500+', label: 'Families Helped' },
        { value: '5 Stars', label: 'Client Reviews' },
        { value: '15+', label: 'Years Local Expert' }
      ]),
      ServicesBlock.grid([
        { name: 'Buyer Representation', description: 'Expert guidance through your home purchase', icon: 'Home' },
        { name: 'Seller Services', description: 'Get top dollar for your property', icon: 'TrendingUp' },
        { name: 'School District Info', description: 'Know the best neighborhoods for families', icon: 'BookOpen' },
        { name: 'Relocation Support', description: 'Making your move smooth and easy', icon: 'MapPin' }
      ]),
      AboutBlock.withImage({
        title: 'Your Neighborhood Expert',
        content: 'As a parent and longtime local resident, I understand what matters to families when choosing a home. Great schools, safe neighborhoods, and community—I help you find it all.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Found us the perfect home near an amazing school. Our kids are thriving!', author: 'The Johnson Family', role: 'First-time Buyers' },
        { quote: 'Made selling and buying with three kids actually manageable. A true professional.', author: 'The Garcia Family', role: 'Move-up Buyers' }
      ]),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Discuss your needs and family priorities' },
        { title: 'Property Search', description: 'Find homes in great neighborhoods with top schools' },
        { title: 'Closing & Purchase', description: 'Smooth process from offer to moving day' }
      ]),
      ContactFormBlock.standard({
        title: 'Let\'s Find Your Home',
        email: 'info@homefamilyrealty.com'
      })
    ]
  },

  {
    id: 'realtor_commercial',
    name: 'Commercial Real Estate',
    description: 'Professional corporate design with slate and amber',
    vertical: 'realtor',
    template_type: 'homepage',
    keywords: ['commercial', 'office', 'retail', 'industrial', 'investment'],
    theme: {
      primary_color: '#334155',
      secondary_color: '#F59E0B',
      accent_color: '#F8FAFC',
      font_heading: 'Montserrat',
      font_body: 'Inter',
      font_family: 'Montserrat, sans-serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'APEX Commercial',
        menu_items: [
          { label: 'Properties', anchor: '#services' },
          { label: 'Services', anchor: '#features' },
          { label: 'About', anchor: '#about' },
          { label: 'Contact', anchor: '#contact' }
        ],
        cta_button: { text: 'Get Market Report', link: '#contact' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'APEX Commercial',
        tagline: 'Strategic Commercial Real Estate Solutions',
        cta: 'View Available Properties'
      }),
      StatsBlock.horizontal([
        { value: '$500M+', label: 'Transaction Volume' },
        { value: '200+', label: 'Deals Closed' },
        { value: '5M+ SF', label: 'Space Leased' }
      ]),
      ServicesBlock.list([
        { name: 'Office Leasing', description: 'Class A and B office space acquisition and disposition' },
        { name: 'Retail Properties', description: 'Shopping centers, strip malls, and standalone retail' },
        { name: 'Industrial/Warehouse', description: 'Distribution, manufacturing, and flex space' },
        { name: 'Investment Sales', description: 'Multi-family and commercial investment properties' }
      ]),
      FeaturesBlock.grid([
        { title: 'Market Intelligence', description: 'Data-driven insights and analysis', icon: 'BarChart' },
        { title: 'Tenant Representation', description: 'Negotiate optimal lease terms', icon: 'FileText' },
        { title: 'Development Advisory', description: 'Ground-up and redevelopment expertise', icon: 'Building' },
        { title: 'Investment Analysis', description: 'ROI projections and due diligence', icon: 'Calculator' }
      ]),
      AboutBlock.withImage({
        title: 'Market Leaders',
        content: 'With over $500 million in transactions, our team brings unmatched expertise to commercial real estate. We deliver strategic insights and results for investors, landlords, and tenants.'
      }),
      ProcessBlock.numbered([
        { title: 'Consultation', description: 'Understand your business needs and investment goals' },
        { title: 'Property Search', description: 'Find the perfect commercial space or investment' },
        { title: 'Closing & Purchase', description: 'Expert negotiation and seamless transaction' }
      ]),
      ContactFormBlock.standard({
        title: 'Request Market Report',
        email: 'info@apexcommercial.com'
      })
    ]
  },

  {
    id: 'realtor_first_time_buyers',
    name: 'First-Time Buyer Expert',
    description: 'Welcoming, educational design with teal and sky',
    vertical: 'realtor',
    template_type: 'homepage',
    keywords: ['first-time buyer', 'starter home', 'affordable', 'education', 'guidance'],
    theme: {
      primary_color: '#059669',
      secondary_color: '#0EA5E9',
      accent_color: '#ECFDF5',
      font_heading: 'Quicksand',
      font_body: 'Nunito',
      font_family: 'Quicksand, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'First Home Guide',
        menu_items: [
          { label: 'How It Works', anchor: '#process' },
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Let\'s Talk', anchor: '#contact' }
        ],
        cta_button: { text: 'Free Buyer Guide', link: '#contact' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'First Home Guide',
        tagline: 'Making Your First Home a Reality',
        cta: 'Download Free Buyer\'s Guide'
      }),
      StatsBlock.horizontal([
        { value: '300+', label: 'First-Time Buyers Helped' },
        { value: '$0', label: 'Buyer Agent Fees' },
        { value: '100%', label: 'Client Satisfaction' }
      ]),
      ProcessBlock.numbered([
        { title: 'Get Pre-Approved', description: 'I\'ll connect you with trusted lenders and explain your options' },
        { title: 'Find Your Home', description: 'Personalized search based on your wishlist and budget' },
        { title: 'Make an Offer', description: 'I\'ll negotiate to get you the best deal possible' },
        { title: 'Close & Celebrate', description: 'Guidance through inspections, paperwork, and keys!' }
      ]),
      ServicesBlock.grid([
        { name: 'Buyer Education', description: 'Understand every step before you take it', icon: 'BookOpen' },
        { name: 'Budget Planning', description: 'Know what you can afford and hidden costs', icon: 'Calculator' },
        { name: 'Home Search', description: 'Find homes matching your criteria', icon: 'Search' },
        { name: 'Negotiation', description: 'Get the best price and terms', icon: 'MessageSquare' }
      ]),
      AboutBlock.withImage({
        title: 'I Specialize in First-Time Buyers',
        content: 'Buying your first home can feel overwhelming—but it doesn\'t have to be. I\'ve helped over 300 first-time buyers navigate the process with confidence. Patient guidance is my specialty.'
      }),
      FAQBlock.accordion([
        { question: 'Do I pay your fees as a buyer?', answer: 'In most transactions, the seller pays buyer agent commissions. My services cost you nothing!' },
        { question: 'How much do I need for a down payment?', answer: 'Many programs require as little as 3-3.5% down. Some offer zero down for qualifying buyers.' },
        { question: 'When should I get pre-approved?', answer: 'Before you start shopping! Pre-approval shows sellers you\'re serious and tells you your budget.' }
      ]),
      ContactFormBlock.standard({
        title: 'Ready to Start Your Home Journey?',
        email: 'hello@firsthomeguide.com'
      })
    ]
  }
];

// =============================================
// PERSONAL TRAINER TEMPLATES (3)
// High energy, fitness-focused
// =============================================

export const PersonalTrainerTemplates: WebsiteTemplate[] = [
  {
    id: 'trainer_gym_fitness',
    name: 'Gym Fitness Pro',
    description: 'Bold, high-energy design with red and dark',
    vertical: 'trainer',
    template_type: 'homepage',
    keywords: ['gym', 'fitness', 'strength', 'muscle', 'workout', 'training'],
    theme: {
      primary_color: '#DC2626',
      secondary_color: '#1F2937',
      accent_color: '#FEF2F2',
      font_heading: 'Oswald',
      font_body: 'Inter',
      font_family: 'Oswald, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'IRONFIT',
        menu_items: [
          { label: 'Programs', anchor: '#services' },
          { label: 'Results', anchor: '#testimonials' },
          { label: 'About', anchor: '#about' },
          { label: 'Join Now', anchor: '#booking' }
        ],
        cta_button: { text: 'Start Training', link: '#booking' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'IronFit Training',
        tagline: 'Transform Your Body. Crush Your Goals.',
        cta: 'Start Your Transformation'
      }),
      StatsBlock.horizontal([
        { value: '500+', label: 'Clients Transformed' },
        { value: '10K+', label: 'Sessions Completed' },
        { value: '15+', label: 'Years Experience' }
      ]),
      ServicesBlock.grid([
        { name: '1:1 Personal Training', description: 'Individualized programs for maximum results', icon: 'Dumbbell' },
        { name: 'Small Group Training', description: 'Motivating group sessions (4-6 people)', icon: 'Users' },
        { name: 'Online Coaching', description: 'Custom programming wherever you are', icon: 'Laptop' },
        { name: 'Nutrition Plans', description: 'Fuel your body for performance', icon: 'Apple' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Lost 40 pounds and gained serious muscle. The program is intense but it WORKS.', author: 'Mike T.', role: 'Lost 40 lbs in 6 months' },
        { quote: 'Finally broke through my plateau. Best investment I\'ve made in my health.', author: 'Jessica R.', role: 'Gained 15 lbs muscle' }
      ]),
      AboutBlock.withImage({
        title: 'Your Coach',
        content: 'Former competitive bodybuilder with 15+ years training experience. NASM Certified Personal Trainer. I\'ve helped hundreds transform their bodies—now it\'s your turn.'
      }),
      PricingBlock.simple([
        { name: '1:1 Sessions', price: '$85/session', features: ['Personalized programming', 'Form coaching', 'Nutrition guidance', '10 pack: $750'] },
        { name: 'Monthly Unlimited', price: '$599/month', features: ['Unlimited 1:1 sessions', 'Custom meal plan', '24/7 messaging support', 'Body composition tracking'], popular: true }
      ]),
      ProcessBlock.numbered([
        { title: 'Free Assessment', description: 'Fitness evaluation and goal setting session' },
        { title: 'Custom Plan', description: 'Build your personalized training and nutrition plan' },
        { title: 'Training Sessions', description: 'Start your transformation with expert coaching' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Book Your First Session',
        services: ['1:1 Personal Training', 'Small Group Training', 'Consultation']
      }),
      CTABlock.primary({
        headline: 'Stop Making Excuses. Start Making Progress.',
        subheadline: 'Your first session is FREE. No commitment required.',
        cta_text: 'Claim Free Session',
        cta_link: '#booking'
      })
    ]
  },

  {
    id: 'trainer_wellness_coach',
    name: 'Wellness Coach',
    description: 'Calming, holistic design with green and mint',
    vertical: 'trainer',
    template_type: 'homepage',
    keywords: ['wellness', 'holistic', 'health', 'balance', 'lifestyle', 'yoga'],
    theme: {
      primary_color: '#059669',
      secondary_color: '#F0FDF4',
      accent_color: '#D1FAE5',
      font_heading: 'Quicksand',
      font_body: 'Lato',
      font_family: 'Quicksand, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Balanced Living',
        menu_items: [
          { label: 'Services', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Testimonials', anchor: '#testimonials' },
          { label: 'Book', anchor: '#booking' }
        ],
        cta_button: { text: 'Free Discovery Call', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Balanced Living',
        tagline: 'Holistic Wellness for Mind, Body & Spirit',
        cta: 'Begin Your Wellness Journey'
      }),
      AboutBlock.withImage({
        title: 'A Different Approach to Fitness',
        content: 'I believe true wellness goes beyond the gym. As a certified personal trainer, yoga instructor, and nutrition coach, I help you build sustainable habits for lasting health and happiness.'
      }),
      ServicesBlock.grid([
        { name: 'Personal Training', description: 'Functional fitness tailored to your body', icon: 'Activity' },
        { name: 'Yoga & Mobility', description: 'Flexibility, balance, and stress relief', icon: 'Flower2' },
        { name: 'Nutrition Coaching', description: 'Nourish your body with real food', icon: 'Apple' },
        { name: 'Lifestyle Coaching', description: 'Sleep, stress, and habit optimization', icon: 'Sun' }
      ]),
      ProcessBlock.numbered([
        { title: 'Discovery Call', description: 'Share your goals and challenges' },
        { title: 'Wellness Assessment', description: 'Understand your starting point' },
        { title: 'Custom Plan', description: 'Your personalized wellness roadmap' },
        { title: 'Ongoing Support', description: 'Regular sessions and adjustments' }
      ]),
      TestimonialsBlock.carousel([
        { quote: 'Finally found balance. Better sleep, more energy, and I actually enjoy moving my body now.', author: 'Amanda K.', role: 'Wellness Client' },
        { quote: 'Not just about losing weight—learned to truly care for myself. Life-changing approach.', author: 'Linda M.', role: 'Lifestyle Transformation' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Start Your Journey',
        services: ['Personal Training', 'Yoga & Mobility', 'Discovery Call']
      }),
      ContactFormBlock.standard({
        title: 'Questions? Let\'s Connect',
        email: 'hello@balancedliving.com'
      })
    ]
  },

  {
    id: 'trainer_sports_performance',
    name: 'Sports Performance',
    description: 'Athletic, dynamic design with blue and orange',
    vertical: 'trainer',
    template_type: 'homepage',
    keywords: ['sports', 'performance', 'athlete', 'speed', 'agility', 'competition'],
    theme: {
      primary_color: '#0EA5E9',
      secondary_color: '#F97316',
      accent_color: '#F0F9FF',
      font_heading: 'Bebas Neue',
      font_body: 'Roboto',
      font_family: 'Bebas Neue, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'ELITE PERFORMANCE',
        menu_items: [
          { label: 'Programs', anchor: '#services' },
          { label: 'Athletes', anchor: '#testimonials' },
          { label: 'About', anchor: '#about' },
          { label: 'Train Now', anchor: '#booking' }
        ],
        cta_button: { text: 'Get Assessed', link: '#booking' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Elite Performance',
        tagline: 'Train Like a Pro. Compete Like a Champion.',
        cta: 'Free Athletic Assessment'
      }),
      StatsBlock.horizontal([
        { value: '50+', label: 'Pro Athletes Trained' },
        { value: 'D1', label: 'College Athletes' },
        { value: '15+', label: 'State Champions' }
      ]),
      ServicesBlock.grid([
        { name: 'Speed & Agility', description: 'Get faster and more explosive', icon: 'Zap' },
        { name: 'Strength & Power', description: 'Build athletic strength that transfers', icon: 'Flame' },
        { name: 'Sport-Specific', description: 'Training designed for your sport', icon: 'Target' },
        { name: 'Recovery', description: 'Optimize recovery and prevent injury', icon: 'Heart' }
      ]),
      AboutBlock.withImage({
        title: 'Former D1 Athlete, Elite Coach',
        content: 'I competed at the highest levels and now train the next generation. My athletes have earned college scholarships, turned pro, and won championships. Your potential is my mission.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Improved my 40 time by 0.3 seconds. Got noticed by scouts and earned my D1 scholarship.', author: 'Marcus J.', role: 'D1 Football Player' },
        { quote: 'The training translated directly to the court. Best off-season of my career.', author: 'Alicia R.', role: 'Professional Basketball' }
      ]),
      PricingBlock.simple([
        { name: 'Assessment', price: 'Free', features: ['Athletic evaluation', 'Movement screening', 'Training recommendations'] },
        { name: 'Performance Training', price: '$100/session', features: ['1:1 training', 'Sport-specific programming', 'Video analysis', 'Progress tracking'], popular: true },
        { name: 'Elite Package', price: '$1,500/month', features: ['Unlimited training', 'Nutrition plan', 'Recovery sessions', 'Mental performance coaching'] }
      ]),
      ProcessBlock.numbered([
        { title: 'Free Assessment', description: 'Athletic evaluation and movement screening' },
        { title: 'Custom Plan', description: 'Sport-specific training program design' },
        { title: 'Training Sessions', description: 'High-performance coaching and progress tracking' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Book Your Assessment',
        services: ['Athletic Assessment', 'Speed & Agility', 'Strength & Power']
      })
    ]
  }
];

// =============================================
// TUTOR TEMPLATES (3)
// Academic, approachable, educational
// =============================================

export const TutorTemplates: WebsiteTemplate[] = [
  {
    id: 'tutor_academic',
    name: 'Academic Tutor',
    description: 'Professional academic design with blue tones',
    vertical: 'tutor',
    template_type: 'homepage',
    keywords: ['academic', 'math', 'science', 'homework', 'grades', 'school'],
    theme: {
      primary_color: '#1E40AF',
      secondary_color: '#DBEAFE',
      accent_color: '#EFF6FF',
      font_heading: 'Merriweather',
      font_body: 'Open Sans',
      font_family: 'Merriweather, serif',
      brand_voice: 'professional'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Academic Excellence',
        menu_items: [
          { label: 'Subjects', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Results', anchor: '#testimonials' },
          { label: 'Get Started', anchor: '#booking' }
        ],
        cta_button: { text: 'Free Assessment', link: '#booking' },
        style: 'solid'
      }),
      HeroBlock.professional({
        name: 'Academic Excellence Tutoring',
        tagline: 'Expert Tutoring for Academic Success',
        cta: 'Schedule Free Assessment'
      }),
      StatsBlock.horizontal([
        { value: '95%', label: 'Grade Improvement' },
        { value: '500+', label: 'Students Helped' },
        { value: 'MIT', label: 'Educated' }
      ]),
      ServicesBlock.grid([
        { name: 'Math', description: 'Pre-algebra through Calculus and beyond', icon: 'Calculator' },
        { name: 'Science', description: 'Physics, Chemistry, Biology', icon: 'Atom' },
        { name: 'English', description: 'Writing, reading comprehension, literature', icon: 'BookOpen' },
        { name: 'Test Prep', description: 'SAT, ACT, AP exams', icon: 'FileText' }
      ]),
      AboutBlock.withImage({
        title: 'Your Expert Tutor',
        content: 'MIT graduate with 10+ years of tutoring experience. I don\'t just help with homework—I teach students how to think, learn, and succeed independently. Every student can excel with the right guidance.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Went from C\'s to A\'s in math. My son actually enjoys it now!', author: 'Patricia M.', role: 'Parent' },
        { quote: 'Helped me understand physics in a way my teacher never could. Got a 5 on my AP exam.', author: 'David L.', role: 'High School Student' }
      ]),
      PricingBlock.simple([
        { name: 'Single Session', price: '$75/hour', features: ['1-hour session', 'Any subject', 'Homework help', 'Concept teaching'] },
        { name: 'Weekly Package', price: '$250/month', features: ['4 hours/month', 'Consistent schedule', 'Progress tracking', 'Parent updates'], popular: true },
        { name: 'Intensive', price: '$600/month', features: ['10 hours/month', 'Exam preparation', 'Custom curriculum', 'Guaranteed improvement'] }
      ]),
      ProcessBlock.numbered([
        { title: 'Assessment', description: 'Evaluate skills and identify learning gaps' },
        { title: 'Learning Plan', description: 'Create personalized curriculum and goals' },
        { title: 'Sessions', description: 'Regular tutoring to build mastery and confidence' }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Book Your Session',
        services: ['Math', 'Science', 'English', 'Test Prep']
      }),
      ContactFormBlock.standard({
        title: 'Questions?',
        email: 'info@academicexcellence.com'
      })
    ]
  },

  {
    id: 'tutor_test_prep',
    name: 'Test Prep Expert',
    description: 'Results-focused design with purple and lavender',
    vertical: 'tutor',
    template_type: 'homepage',
    keywords: ['SAT', 'ACT', 'test prep', 'college', 'scores', 'admission'],
    theme: {
      primary_color: '#7C3AED',
      secondary_color: '#EDE9FE',
      accent_color: '#F5F3FF',
      font_heading: 'Poppins',
      font_body: 'Inter',
      font_family: 'Poppins, sans-serif',
      brand_voice: 'bold'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Score Higher',
        menu_items: [
          { label: 'Programs', anchor: '#services' },
          { label: 'Results', anchor: '#stats' },
          { label: 'About', anchor: '#about' },
          { label: 'Enroll', anchor: '#booking' }
        ],
        cta_button: { text: 'Free Practice Test', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.professional({
        name: 'Score Higher Test Prep',
        tagline: 'Raise Your Score. Reach Your Dream School.',
        cta: 'Get Your Free Practice Test'
      }),
      StatsBlock.horizontal([
        { value: '+200', label: 'Avg SAT Increase' },
        { value: '+5', label: 'Avg ACT Increase' },
        { value: '99%', label: 'College Acceptance' }
      ]),
      ServicesBlock.grid([
        { name: 'SAT Prep', description: 'Comprehensive prep for top scores', icon: 'FileText' },
        { name: 'ACT Prep', description: 'Strategic preparation for all sections', icon: 'CheckSquare' },
        { name: 'AP Exams', description: 'Subject-specific AP preparation', icon: 'Award' },
        { name: 'College Essays', description: 'Stand out in your applications', icon: 'Edit' }
      ]),
      ProcessBlock.numbered([
        { title: 'Diagnostic Test', description: 'Identify your baseline and weak areas' },
        { title: 'Custom Plan', description: 'Targeted strategy for maximum improvement' },
        { title: 'Intensive Prep', description: 'Practice tests and skill building' },
        { title: 'Test Day Ready', description: 'Confident and prepared to excel' }
      ]),
      AboutBlock.withImage({
        title: 'Perfect Scores, Expert Teaching',
        content: 'I scored in the 99th percentile on both SAT and ACT. More importantly, I\'ve helped hundreds of students significantly raise their scores and get into their dream schools. I know exactly what works.'
      }),
      TestimonialsBlock.carousel([
        { quote: 'Went from 1250 to 1480 on my SAT. Now I\'m at USC!', author: 'Emma T.', role: 'Now at USC' },
        { quote: 'Raised my ACT from 26 to 33. The strategies really work.', author: 'Jordan M.', role: 'Now at Northwestern' }
      ]),
      PricingBlock.simple([
        { name: '8-Week Program', price: '$1,200', features: ['2 sessions/week', 'Full practice tests', 'Score analysis', 'Study materials'] },
        { name: '12-Week Intensive', price: '$2,400', features: ['3 sessions/week', 'Unlimited practice tests', 'College counseling', 'Essay review', 'Score guarantee'], popular: true }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Start Your Test Prep',
        services: ['SAT Prep', 'ACT Prep', 'Free Diagnostic']
      })
    ]
  },

  {
    id: 'tutor_language',
    name: 'Language Tutor',
    description: 'Warm, cultural design with green and amber',
    vertical: 'tutor',
    template_type: 'homepage',
    keywords: ['language', 'Spanish', 'French', 'ESL', 'conversation', 'fluency'],
    theme: {
      primary_color: '#059669',
      secondary_color: '#F59E0B',
      accent_color: '#ECFDF5',
      font_heading: 'Nunito',
      font_body: 'Lato',
      font_family: 'Nunito, sans-serif',
      brand_voice: 'warm'
    },
    blocks: [
      HeaderBlock.standard({
        logo_text: 'Fluent Future',
        menu_items: [
          { label: 'Languages', anchor: '#services' },
          { label: 'About', anchor: '#about' },
          { label: 'Approach', anchor: '#process' },
          { label: 'Book Lesson', anchor: '#booking' }
        ],
        cta_button: { text: 'Free Trial Lesson', link: '#booking' },
        style: 'blur'
      }),
      HeroBlock.warm({
        name: 'Fluent Future',
        tagline: 'Speak Confidently in Any Language',
        cta: 'Book Your Free Trial'
      }),
      ServicesBlock.grid([
        { name: 'Spanish', description: 'From basics to native fluency', icon: '🇪🇸' },
        { name: 'French', description: 'Parisian elegance, global reach', icon: '🇫🇷' },
        { name: 'English (ESL)', description: 'Business and everyday English', icon: '🇬🇧' },
        { name: 'Mandarin', description: 'Open doors to China', icon: '🇨🇳' }
      ]),
      AboutBlock.withImage({
        title: 'Your Language Journey Starts Here',
        content: 'Native speaker of three languages with 12 years of teaching experience. I believe everyone can learn a language—it\'s about finding the right approach. My conversation-first method gets you speaking from day one.'
      }),
      ProcessBlock.numbered([
        { title: 'Free Trial', description: 'Experience my teaching style' },
        { title: 'Level Assessment', description: 'Understand your current abilities' },
        { title: 'Custom Curriculum', description: 'Lessons tailored to your goals' },
        { title: 'Consistent Practice', description: 'Regular sessions for steady progress' }
      ]),
      FeaturesBlock.grid([
        { title: 'Native Speakers', description: 'Learn authentic pronunciation', icon: 'MessageCircle' },
        { title: 'Flexible Schedule', description: 'Lessons fit your lifestyle', icon: 'Calendar' },
        { title: 'Cultural Immersion', description: 'Language in context', icon: 'Globe' },
        { title: 'All Levels', description: 'Beginner to advanced', icon: 'TrendingUp' }
      ]),
      PricingBlock.simple([
        { name: 'Single Lesson', price: '$50/hour', features: ['1-hour session', 'Conversation practice', 'Homework materials'] },
        { name: '10-Lesson Package', price: '$400', features: ['10 hours', 'Progress tracking', 'Cultural insights', 'Save $100'], popular: true },
        { name: 'Intensive Month', price: '$800', features: ['20 hours', 'Daily practice plan', 'Immersion activities', 'Rapid progress'] }
      ]),
      BookingWidgetBlock.embedded({
        title: 'Start Learning Today',
        services: ['Spanish', 'French', 'English (ESL)', 'Mandarin']
      }),
      ContactFormBlock.standard({
        title: 'Questions?',
        email: 'learn@fluentfuture.com'
      })
    ]
  }
];

// =============================================
// EXPORT ALL TEMPLATES
// =============================================

export const WEBSITE_TEMPLATES: WebsiteTemplate[] = [
  ...TherapistTemplates,
  ...CoachTemplates,
  ...ConsultantTemplates,
  ...LawyerTemplates,
  ...PhotographerTemplates,
  ...RealEstateTemplates,
  ...PersonalTrainerTemplates,
  ...TutorTemplates
];

// Alias for backwards compatibility
export const AllTemplates = WEBSITE_TEMPLATES;

// Helper function to get templates by vertical
export function getTemplatesByVertical(vertical: string): WebsiteTemplate[] {
  return WEBSITE_TEMPLATES.filter(t => t.vertical === vertical);
}

// Helper function to get template by ID
export function getTemplateById(id: string): WebsiteTemplate | undefined {
  return WEBSITE_TEMPLATES.find(t => t.id === id);
}

// Helper function to get all verticals
export function getVerticals(): string[] {
  return [...new Set(WEBSITE_TEMPLATES.map(t => t.vertical))];
}

// Helper function to find template by keywords (for AI selection)
export function findTemplateByKeywords(keywords: string[], vertical?: string): WebsiteTemplate | undefined {
  const templates = vertical
    ? getTemplatesByVertical(vertical)
    : WEBSITE_TEMPLATES;

  // Score each template based on keyword matches
  const scored = templates.map(template => {
    const templateKeywords = template.keywords || [];
    const matches = keywords.filter(kw =>
      templateKeywords.some(tk => tk.toLowerCase().includes(kw.toLowerCase()))
    );
    return { template, score: matches.length };
  });

  // Return the best match
  const sorted = scored.sort((a, b) => b.score - a.score);
  return sorted[0]?.score > 0 ? sorted[0].template : templates[0];
}
