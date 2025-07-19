import { describe, it, expect } from 'vitest';
import { 
	validateUrl, 
	sanitizeText, 
	validateTags, 
	validateBranchName, 
	validateFilePath, 
	sanitizeCommitMessage,
	validateEmail,
	checkRateLimit 
} from '../src/security';

describe('Security Functions', () => {
	describe('validateUrl', () => {
		it('accepts valid HTTPS URLs', () => {
			expect(validateUrl('https://example.com')).toBe(true);
			expect(validateUrl('https://github.com/user/repo')).toBe(true);
		});

		it('accepts valid HTTP URLs', () => {
			expect(validateUrl('http://example.com')).toBe(true);
		});

		it('rejects invalid protocols', () => {
			expect(validateUrl('ftp://example.com')).toBe(false);
			expect(validateUrl('javascript:alert(1)')).toBe(false);
			expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
		});

		it('rejects localhost and private IPs', () => {
			expect(validateUrl('http://localhost')).toBe(false);
			expect(validateUrl('http://127.0.0.1')).toBe(false);
			expect(validateUrl('http://192.168.1.1')).toBe(false);
			expect(validateUrl('http://10.0.0.1')).toBe(false);
			expect(validateUrl('http://172.16.0.1')).toBe(false);
		});

		it('rejects malformed URLs', () => {
			expect(validateUrl('not-a-url')).toBe(false);
			expect(validateUrl('')).toBe(false);
			expect(validateUrl(null as any)).toBe(false);
		});
	});

	describe('sanitizeText', () => {
		it('removes HTML tags', () => {
			expect(sanitizeText('Hello <script>alert(1)</script>')).toBe('Hello scriptalert(1)/script');
			expect(sanitizeText('<b>Bold</b> text')).toBe('bBold/b text');
		});

		it('removes dangerous characters', () => {
			expect(sanitizeText('Hello `whoami`')).toBe('Hello whoami');
			expect(sanitizeText('Test $USER variable')).toBe('Test USER variable');
		});

		it('limits consecutive newlines', () => {
			expect(sanitizeText('Line1\n\n\n\nLine2')).toBe('Line1\n\nLine2');
		});

		it('handles invalid input', () => {
			expect(sanitizeText(null as any)).toBe('');
			expect(sanitizeText(undefined as any)).toBe('');
		});
	});

	describe('validateTags', () => {
		it('accepts valid tags', () => {
			const result = validateTags(['tech', 'programming', 'web-dev']);
			expect(result).toEqual(['tech', 'programming', 'web-dev']);
		});

		it('filters out invalid tags', () => {
			const result = validateTags(['', 'valid', '<script>alert(1)</script>', 'a'.repeat(100)]);
			expect(result).toEqual(['valid', 'scriptalert(1)/script']);
		});

		it('limits number of tags', () => {
			const manyTags = Array.from({length: 15}, (_, i) => `tag${i}`);
			const result = validateTags(manyTags);
			expect(result.length).toBeLessThanOrEqual(10);
		});

		it('handles invalid input', () => {
			expect(validateTags(null as any)).toEqual([]);
			expect(validateTags('not-array' as any)).toEqual([]);
		});
	});

	describe('validateBranchName', () => {
		it('accepts valid branch names', () => {
			expect(validateBranchName('feature/new-post')).toBe(true);
			expect(validateBranchName('link/2023-12-01-test')).toBe(true);
		});

		it('rejects invalid branch names', () => {
			expect(validateBranchName('../malicious')).toBe(false);
			expect(validateBranchName('.hidden')).toBe(false);
			expect(validateBranchName('ends.')).toBe(false);
			expect(validateBranchName('has..dots')).toBe(false);
			expect(validateBranchName('has//slashes')).toBe(false);
		});

		it('rejects overly long names', () => {
			const longName = 'a'.repeat(300);
			expect(validateBranchName(longName)).toBe(false);
		});
	});

	describe('validateFilePath', () => {
		it('accepts valid file paths', () => {
			expect(validateFilePath('content/posts/links/2023-12-01-test.md')).toBe(true);
		});

		it('rejects path traversal attempts', () => {
			expect(validateFilePath('../etc/passwd')).toBe(false);
			expect(validateFilePath('content/../sensitive.md')).toBe(false);
			expect(validateFilePath('/absolute/path.md')).toBe(false);
		});

		it('rejects invalid file locations', () => {
			expect(validateFilePath('wrong/location/file.md')).toBe(false);
			expect(validateFilePath('content/posts/links/file.txt')).toBe(false);
		});
	});

	describe('validateEmail', () => {
		it('accepts valid email addresses', () => {
			expect(validateEmail('user@example.com')).toBe(true);
			expect(validateEmail('test.email+tag@domain.co.uk')).toBe(true);
		});

		it('rejects invalid email addresses', () => {
			expect(validateEmail('invalid-email')).toBe(false);
			expect(validateEmail('@domain.com')).toBe(false);
			expect(validateEmail('user@')).toBe(false);
			expect(validateEmail('')).toBe(false);
		});

		it('rejects overly long emails', () => {
			const longEmail = 'a'.repeat(300) + '@example.com';
			expect(validateEmail(longEmail)).toBe(false);
		});
	});

	describe('checkRateLimit', () => {
		it('allows requests within limit', () => {
			const identifier = 'test-user-1';
			expect(checkRateLimit(identifier, 5, 60000)).toBe(true);
			expect(checkRateLimit(identifier, 5, 60000)).toBe(true);
		});

		it('blocks requests over limit', () => {
			const identifier = 'test-user-2';
			// Use up the limit
			for (let i = 0; i < 5; i++) {
				checkRateLimit(identifier, 5, 60000);
			}
			// This should be blocked
			expect(checkRateLimit(identifier, 5, 60000)).toBe(false);
		});
	});
});
