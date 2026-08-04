'use client';

import { motion } from 'framer-motion';
import { Linkedin, Twitter, Mail } from 'lucide-react';
import type { BlockRendererProps, TeamMemberItem } from './types';

interface TeamContent {
  title?: string;
  subtitle?: string;
  members: TeamMemberItem[];
  layout?: 'grid' | 'list' | 'cards';
}

export function TeamBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title = 'Meet the Team',
    subtitle,
    members = [],
    layout = 'grid'
  } = content as TeamContent;

  const columns = styles?.columns || 3;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const gridColsClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  }[columns] || 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-gray-50 dark:bg-slate-900'} ${className || ''}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || subtitle) && (
          <div className="text-center mb-12">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: 'var(--website-font-heading)' }}
              >
                {title}
              </motion.h2>
            )}
            {subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-4 text-lg text-gray-600 dark:text-gray-300"
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {subtitle}
              </motion.p>
            )}
          </div>
        )}

        {/* Grid Layout */}
        {layout === 'grid' && (
          <div className={`grid ${gridColsClass} gap-8`}>
            {members.map((member, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center"
              >
                {member.image ? (
                  <img
                    src={member.image}
                    alt={member.name}
                    className="w-32 h-32 mx-auto rounded-full object-cover shadow-lg"
                  />
                ) : (
                  <div
                    className="w-32 h-32 mx-auto rounded-full flex items-center justify-center text-4xl text-white shadow-lg"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {member.name.charAt(0)}
                  </div>
                )}
                <h3
                  className="mt-6 text-xl font-semibold text-gray-900 dark:text-white"
                  style={{ fontFamily: 'var(--website-font-heading)' }}
                >
                  {member.name}
                </h3>
                <p
                  className="mt-1 text-sm font-medium"
                  style={{ color: primaryColor }}
                >
                  {member.role}
                </p>
                {member.bio && (
                  <p
                    className="mt-3 text-gray-600 dark:text-gray-400"
                    style={{ fontFamily: 'var(--website-font-body)' }}
                  >
                    {member.bio}
                  </p>
                )}
                {member.social && (
                  <div className="mt-4 flex justify-center gap-4">
                    {member.social.linkedin && (
                      <a
                        href={member.social.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 transition-colors"
                      >
                        <Linkedin className="w-5 h-5" />
                      </a>
                    )}
                    {member.social.twitter && (
                      <a
                        href={member.social.twitter}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-sky-500 transition-colors"
                      >
                        <Twitter className="w-5 h-5" />
                      </a>
                    )}
                    {member.social.email && (
                      <a
                        href={`mailto:${member.social.email}`}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Mail className="w-5 h-5" />
                      </a>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Cards Layout */}
        {layout === 'cards' && (
          <div className={`grid ${gridColsClass} gap-6`}>
            {members.map((member, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-lg group"
                style={{ borderRadius: theme?.borderRadius || '1rem' }}
              >
                {member.image ? (
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ) : (
                  <div
                    className="aspect-[4/3] flex items-center justify-center text-6xl text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {member.name.charAt(0)}
                  </div>
                )}
                <div className="p-6">
                  <h3
                    className="text-xl font-semibold text-gray-900 dark:text-white"
                    style={{ fontFamily: 'var(--website-font-heading)' }}
                  >
                    {member.name}
                  </h3>
                  <p
                    className="mt-1 text-sm font-medium"
                    style={{ color: primaryColor }}
                  >
                    {member.role}
                  </p>
                  {member.bio && (
                    <p
                      className="mt-3 text-sm text-gray-600 dark:text-gray-400 line-clamp-3"
                      style={{ fontFamily: 'var(--website-font-body)' }}
                    >
                      {member.bio}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* List Layout */}
        {layout === 'list' && (
          <div className="max-w-3xl mx-auto space-y-6">
            {members.map((member, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex gap-6 items-start p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm"
                style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
              >
                {member.image ? (
                  <img
                    src={member.image}
                    alt={member.name}
                    className="w-20 h-20 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-2xl text-white flex-shrink-0"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {member.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3
                    className="text-lg font-semibold text-gray-900 dark:text-white"
                    style={{ fontFamily: 'var(--website-font-heading)' }}
                  >
                    {member.name}
                  </h3>
                  <p
                    className="text-sm font-medium"
                    style={{ color: primaryColor }}
                  >
                    {member.role}
                  </p>
                  {member.bio && (
                    <p
                      className="mt-2 text-gray-600 dark:text-gray-400"
                      style={{ fontFamily: 'var(--website-font-body)' }}
                    >
                      {member.bio}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
