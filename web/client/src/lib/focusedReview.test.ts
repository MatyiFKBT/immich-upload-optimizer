import { describe, expect, it } from 'vitest';
import { buildReviewStacks } from './focusedReview';
import type { LibraryAsset } from '../types';

function asset(id: string, localDateTime: string, isVideo = false): LibraryAsset {
  return {
    id,
    originalFileName: `${id}.${isVideo ? 'mp4' : 'jpg'}`,
    originalMimeType: isVideo ? 'video/mp4' : 'image/jpeg',
    localDateTime,
    fileCreatedAt: localDateTime,
    size: 1024,
    isVideo,
    visibility: 'timeline',
    optimized: false,
    people: [],
    profiles: [],
  };
}

describe('buildReviewStacks', () => {
  it('groups stills captured within the same local minute', () => {
    const stacks = buildReviewStacks([
      asset('a', '2025-05-03T09:14:02'),
      asset('b', '2025-05-03T09:14:58'),
    ]);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(stacks[0]?.day).toBe('2025-05-03');
    expect(stacks[0]?.minute).toBe('2025-05-03T09:14');
  });

  it('keeps different minutes and local days in chronological stacks', () => {
    const stacks = buildReviewStacks([
      asset('c', '2025-05-04T00:02:00'),
      asset('b', '2025-05-03T09:15:00'),
      asset('a', '2025-05-03T09:14:00'),
    ]);

    expect(stacks.map((stack) => stack.items[0]?.id)).toEqual(['a', 'b', 'c']);
    expect(stacks.map((stack) => stack.day)).toEqual(['2025-05-03', '2025-05-03', '2025-05-04']);
  });

  it('reviews videos as independent one-item stacks instead of grouping them with stills', () => {
    const stacks = buildReviewStacks([
      asset('photo-a', '2025-05-03T09:14:02'),
      asset('clip', '2025-05-03T09:14:15', true),
      asset('photo-b', '2025-05-03T09:14:58'),
    ]);

    expect(stacks).toHaveLength(2);
    expect(stacks[0]?.items.map((item) => item.id)).toEqual(['photo-a', 'photo-b']);
    expect(stacks[1]?.items.map((item) => item.id)).toEqual(['clip']);
  });

  it('leaves single photos as separate stacks when the singles grid is off', () => {
    const stacks = buildReviewStacks([
      asset('a', '2025-05-03T09:14:00'),
      asset('b', '2025-05-03T09:15:00'),
    ]);

    expect(stacks.map((stack) => stack.layout)).toEqual(['row', 'row']);
  });

  it('collects runs of single photos between burst stacks into grid pages', () => {
    const stacks = buildReviewStacks([
      asset('single-a', '2025-05-03T09:14:00'),
      asset('single-b', '2025-05-03T09:15:00'),
      asset('burst-a', '2025-05-03T09:16:00'),
      asset('burst-b', '2025-05-03T09:16:30'),
      asset('single-c', '2025-05-03T09:17:00'),
    ], 2);

    expect(stacks.map((stack) => stack.layout)).toEqual(['grid', 'row', 'row']);
    expect(stacks[0]?.items.map((item) => item.id)).toEqual(['single-a', 'single-b']);
    expect(stacks[0]?.columns).toBe(2);
    expect(stacks[1]?.items.map((item) => item.id)).toEqual(['burst-a', 'burst-b']);
    expect(stacks[2]?.items.map((item) => item.id)).toEqual(['single-c']);
  });

  it('chunks a long run of singles by the selected grid size', () => {
    const stacks = buildReviewStacks([
      ...Array.from({ length: 5 }, (_, index) => asset(`single-${index}`, `2025-05-03T09:1${index}:00`)),
    ], 2);

    expect(stacks.map((stack) => stack.layout)).toEqual(['grid', 'row']);
    expect(stacks[0]?.items).toHaveLength(4);
    expect(stacks[1]?.items).toHaveLength(1);
  });

  it('does not group singles across a day boundary', () => {
    const stacks = buildReviewStacks([
      asset('late', '2025-05-03T23:59:00'),
      asset('early', '2025-05-04T00:00:00'),
    ], 2);

    expect(stacks.map((stack) => stack.layout)).toEqual(['row', 'row']);
  });
});
