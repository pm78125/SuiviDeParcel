import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabaseUrl = 'https://bteegqluqlvvtfkbxpug.supabase.co';
export const supabaseKey = 'sb_publishable_D11UqHX2pu9y789X6HTKfw_dFH-x4xP';
export const supabase = createClient(supabaseUrl, supabaseKey);

export const BUCKET_NAME = 'carte';
export const FILE_NAME = 'mon_plan.jpg';
