/**
 * Security utilities for input validation and sanitization
 */

// URL validation with security checks
export function validateUrl(url: string): boolean {
	if (!url || typeof url !== 'string') {
		return false;
	}

	// Check for basic URL format
	try {
		const urlObj = new URL(url);
		
		// Only allow http and https protocols
		if (!['http:', 'https:'].includes(urlObj.protocol)) {
			return false;
		}

		// Prevent localhost and private IP ranges for security
		const hostname = urlObj.hostname.toLowerCase();
		if (hostname === 'localhost' || 
			hostname === '127.0.0.1' ||
			hostname.startsWith('192.168.') ||
			hostname.startsWith('10.') ||
			hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
			hostname === '0.0.0.0' ||
			hostname === '::1' ||
			hostname.startsWith('fe80:') ||
			hostname.startsWith('fc00:') ||
			hostname.startsWith('fd00:')) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

// Sanitize text content to prevent injection attacks
export function sanitizeText(text: string): string {
	if (!text || typeof text !== 'string') {
		return '';
	}

	// Remove/escape potentially dangerous characters
	return text
		.replace(/[<>]/g, '') // Remove HTML tags
		.replace(/[`$]/g, '') // Remove template literal and shell injection chars
		.replace(/[\r\n]{3,}/g, '\n\n') // Limit consecutive newlines
		.trim();
}

// Validate and sanitize tags
export function validateTags(tags: string[]): string[] {
	if (!Array.isArray(tags)) {
		return [];
	}

	return tags
		.filter(tag => typeof tag === 'string' && tag.length > 0)
		.map(tag => sanitizeText(tag))
		.filter(tag => tag.length > 0 && tag.length <= 50) // Reasonable tag length limit
		.slice(0, 10); // Limit number of tags
}

// Validate GitHub branch name
export function validateBranchName(name: string): boolean {
	if (!name || typeof name !== 'string') {
		return false;
	}

	// GitHub branch name rules
	const validPattern = /^[a-zA-Z0-9._\/-]+$/;
	return validPattern.test(name) && 
		   name.length <= 250 && 
		   !name.startsWith('.') && 
		   !name.endsWith('.') &&
		   !name.includes('..') &&
		   !name.includes('//');
}

// Validate file path for GitHub
export function validateFilePath(path: string): boolean {
	if (!path || typeof path !== 'string') {
		return false;
	}

	// Prevent path traversal
	if (path.includes('../') || path.includes('..\\') || path.startsWith('/')) {
		return false;
	}

	// Must be a reasonable markdown file in expected location
	return path.startsWith('content/posts/links/') && 
		   path.endsWith('.md') &&
		   path.length <= 200;
}

// Sanitize commit message
export function sanitizeCommitMessage(message: string): string {
	if (!message || typeof message !== 'string') {
		return 'Automated commit';
	}

	return sanitizeText(message).substring(0, 100); // Limit commit message length
}

// Validate email address format
export function validateEmail(email: string): boolean {
	if (!email || typeof email !== 'string') {
		return false;
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email) && email.length <= 254; // RFC 5321 limit
}

// Rate limiting helper - simple in-memory store for Cloudflare Workers
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(identifier: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
	const now = Date.now();
	const record = requestCounts.get(identifier);

	if (!record || now > record.resetTime) {
		// Reset window
		requestCounts.set(identifier, { count: 1, resetTime: now + windowMs });
		return true;
	}

	if (record.count >= maxRequests) {
		return false;
	}

	record.count++;
	return true;
}