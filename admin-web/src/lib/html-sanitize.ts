export const sanitizeHtml = (html: string): string => {
  if (!html) return '';

  const withoutDangerousTags = html
    .replace(/<\s*(script|iframe|object|embed|svg|math|form|meta|link|base|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|svg|math|form|meta|link|base|style)\b[^>]*>/gi, '');

  const withoutEventHandlers = withoutDangerousTags.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  const withoutDangerousUrls = withoutEventHandlers.replace(
    /\s(?:href|src|xlink:href)\s*=\s*(?:"|')\s*(?:javascript:|vbscript:|data:(?:text\/html|application\/javascript|image\/svg\+xml))[^"'\s>]*\s*(?:"|')/gi,
    ' '
  );

  return withoutDangerousUrls.replace(/srcdoc\s*=\s*(?:"[^"]*"|'[^']*')/gi, '').trim();
};
