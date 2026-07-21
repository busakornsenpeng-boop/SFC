const { parseThaiDateTime, buildWaitUpdateData, buildJobId } = require('../../lib/repairWorkflow');

describe('repair workflow helpers', () => {
  it('converts Buddhist Era date values', () => {
    const date = parseThaiDateTime('1/2/2569, 03:04:05');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 1, 1, 3, 4]);
    expect(parseThaiDateTime('invalid')).toBeNull();
    expect(parseThaiDateTime()).toBeNull();
  });

  it('records and closes wait intervals deterministically', () => {
    const now = new Date('2026-02-01T04:00:00Z');
    expect(buildWaitUpdateData(4, 'รอซ่อม', 'รออะไหล่', '', '', now)).toHaveLength(1);
    expect(buildWaitUpdateData(4, 'รออะไหล่', 'กำลังซ่อม', '1/2/2569, 10:00:00', '20', now)[0].values).toEqual([[80]]);
    expect(buildWaitUpdateData(4, 'กำลังซ่อม', 'ซ่อมเสร็จ', '', '', now)).toEqual([]);
  });

  it('generates sequential monthly Job IDs', () => {
    expect(buildJobId('Production', ['PRO-001-010226', 'QA-002-010226'], new Date('2026-02-01'))).toBe('PRO-003-010226');
  });
});
