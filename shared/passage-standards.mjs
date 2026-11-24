import {phrase} from './i18n.mjs';
import {PARTICLE_LIMIT, PRESSURE_LIMIT} from './puzzles.mjs';
export const PASSAGE_STANDARDS = {
  lights: {
    label: '查看压差表检定标签',
    reading: phrase('压差 ≤ {limit}', {limit: PRESSURE_LIMIT}),
    location: '压差标准待查：在设备走廊校零，查看检修盒便签，再逐档测试。'
  },
  microscope: {
    label: '查看颗粒判读卡',
    reading: phrase('颗粒指数 ≤ {limit}', {limit: PARTICLE_LIMIT}),
    location: '颗粒标准待查：研究室显微镜，切换到紫光。'
  },
  photo: {
    label: '翻看相框背面的验收便签',
    reading: '门锁联锁必须响应。',
    location: '联锁标准待查：在档案室研究组合照的夹层里检查试运行连拍。'
  }
};

export function missingPassageStandards(standards) {
  return Object.keys(PASSAGE_STANDARDS).filter(id => !standards?.[id]);
}

export function hasPressureBoundary(gauge) {
  return gauge?.calibrated === true && gauge.noteFound === true && Array.isArray(gauge.tested) &&
    gauge.tested.includes(PRESSURE_LIMIT) && gauge.tested.includes(PRESSURE_LIMIT + 1);
}
