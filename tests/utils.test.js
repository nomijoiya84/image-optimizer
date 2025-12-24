import { describe, it, expect } from 'vitest';
import { formatFileSize, getCompressionPercentage, getCompressionLabel } from '../js/utils.js';

describe('Utility Functions', () => {
    describe('formatFileSize', () => {
        it('should format bytes correctly', () => {
            expect(formatFileSize(0)).toBe('0 Bytes');
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(1048576)).toBe('1 MB');
        });

        it('should handle negative values', () => {
            expect(formatFileSize(-1024)).toBe('-1 KB');
        });
    });

    describe('getCompressionPercentage', () => {
        it('should calculate correct percentage', () => {
            expect(getCompressionPercentage(100, 20)).toBe(80);
            expect(getCompressionPercentage(100, 100)).toBe(0);
            expect(getCompressionPercentage(100, 150)).toBe(-50);
        });

        it('should handle zero original size', () => {
            expect(getCompressionPercentage(0, 50)).toBe(0);
        });
    });

    describe('getCompressionLabel', () => {
        it('should return correct labels', () => {
            expect(getCompressionLabel(100, 20)).toBe('80% smaller');
            expect(getCompressionLabel(100, 150)).toBe('50% larger');
            expect(getCompressionLabel(100, 100)).toBe('0% smaller');
        });
    });
});
