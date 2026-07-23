import { SCHEMA_VERSION, clone, isSerialLikeModel, migrateRecord } from './worker-engine.js';
export const UNIT_RECORDS_KEY = 'daham_qualification_records_v3';
export const MODEL_PIPE_KEY = 'daham_qualification_recipes_v3';
const read = (s,k,d) => { try { return JSON.parse(s.getItem(k) || JSON.stringify(d)); } catch { return d; } };
const write = (s,k,v) => s.setItem(k, JSON.stringify(v));
export function saveUnitRecord(storage, state, results, confirmReplace=()=>true) { const clean=migrateRecord(state); if (!clean.unit.unitModel || isSerialLikeModel(clean.unit.unitModel)) return {saved:false,reason:'Valid model number is required.'}; const id=`${clean.unit.unitNumber}__${clean.unit.unitModel}__${Date.now()}`; const records=listUnitRecords(storage); if (!confirmReplace(id)) return {saved:false,reason:'Save cancelled.'}; const record={schemaVersion:SCHEMA_VERSION,id,state:clean,results:clone(results),savedAt:new Date().toISOString(),audit:{event:'test-record-saved'}}; records.push(record);write(storage,UNIT_RECORDS_KEY,records);return {saved:true,record}; }
export function listUnitRecords(storage) { return read(storage,UNIT_RECORDS_KEY,[]).filter(r=>r.schemaVersion===SCHEMA_VERSION); }
export function loadUnitRecord(storage,id) { const r=listUnitRecords(storage).find(x=>x.id===id);return r?clone(r):null; }
export function saveModelPipeData(storage, model, recipe) { if (!model || isSerialLikeModel(model)) return {saved:false,reason:'Valid model required.'};const data=read(storage,MODEL_PIPE_KEY,{});data[model]=clone(recipe);write(storage,MODEL_PIPE_KEY,data);return {saved:true,record:data[model]}; }
export function getModelPipeData(storage,model) { const r=read(storage,MODEL_PIPE_KEY,{})[model];return r?clone(r):null; }
export const exportSavedData=storage=>({schemaVersion:SCHEMA_VERSION,unitRecords:listUnitRecords(storage)});
export function importSavedData(storage,payload) { if (!payload || payload.schemaVersion!==SCHEMA_VERSION) return {imported:false,reason:'Backup version incompatible.'};write(storage,UNIT_RECORDS_KEY,payload.unitRecords||[]);return {imported:true,unitCount:(payload.unitRecords||[]).length}; }
export function memoryStorage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()};}
