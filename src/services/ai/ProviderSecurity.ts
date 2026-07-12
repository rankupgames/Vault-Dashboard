/** Default endpoint used when no OpenRouter-compatible base URL is configured. */
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Maximum provider error text retained in dispatch records. */
export const MAX_PROVIDER_ERROR_TEXT_LENGTH = 4000;

/** Filesystem character subset accepted for configured executable paths. */
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9_/.\-~]+$/;

/** Reports whether Node process APIs are available inside Obsidian desktop. */
export const isDesktopNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && process.versions?.node !== undefined && typeof require === 'function';

/** Rejects executable paths containing shell metacharacters. */
export const validateToolPath = (path: string): boolean =>
	path === '' || SAFE_PATH_PATTERN.test(path);

/** Redacts common secret-bearing headers, environment variables, and token shapes. */
export const redactSensitiveText = (value: string): string =>
	value
		.replace(/(Authorization\s*:\s*Bearer\s+)[^\s"'\\]+/gi, '$1[redacted]')
		.replace(/\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|api[_-]?key|token|password|secret)\b\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[redacted]')
		.replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-api-key]');

/** Caps provider text so failed records cannot retain large response bodies. */
export const truncateProviderText = (value: string, maxLength = MAX_PROVIDER_ERROR_TEXT_LENGTH): string => {
	if (value.length <= maxLength) return value;
	return `${value.substring(0, maxLength)}\n... (truncated)`;
};

/** Applies redaction and size limits to provider text before storage or logging. */
export const sanitizeProviderText = (value: string): string =>
	truncateProviderText(redactSensitiveText(value).trim());

/** Validates and normalizes an HTTPS base URL before authorization headers are sent. */
export const normalizeOpenRouterBaseUrl = (value: string): string => {
	const rawValue = value.trim() || DEFAULT_OPENROUTER_BASE_URL;
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(rawValue);
	} catch {
		throw new Error('OpenRouter base URL must be a valid HTTPS URL.');
	}

	if (parsedUrl.protocol !== 'https:') {
		throw new Error('OpenRouter base URL must use HTTPS.');
	}
	if (parsedUrl.username !== '' || parsedUrl.password !== '') {
		throw new Error('OpenRouter base URL cannot include credentials.');
	}
	if (parsedUrl.search !== '' || parsedUrl.hash !== '') {
		throw new Error('OpenRouter base URL cannot include query strings or fragments.');
	}

	return parsedUrl.toString().replace(/\/+$/, '');
};
