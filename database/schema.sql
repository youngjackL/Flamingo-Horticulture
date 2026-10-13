-- 1. Greenhouse Blocks Table
create table greenhouse_blocks (
  id uuid primary key default gen_random_uuid(),
  block_name text not null,
  variety text not null, -- 'Roses', 'Carnations', 'Chrysanthemums'
  target_harvest_days int not null
);

-- 2. Growth Scans Log Table
create table growth_scans (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references greenhouse_blocks(id) on delete cascade,
  scanned_at timestamp with time zone default timezone('utc'::text, now()) not null,
  crop_type text not null,
  avg_stem_height_cm float not null,
  avg_bud_diameter_cm float not null,
  estimated_yield_units int not null,
  confidence_score float not null,
  image_url text
);

-- 3. Harvest Forecasts Table
create table harvest_forecasts (
  id uuid primary key default gen_random_uuid(),
  block_id uuid references greenhouse_blocks(id) on delete cascade,
  projected_harvest_date date not null,
  projected_export_volume_stems int not null,
  velocity_cm_per_day float not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table greenhouse_blocks enable row level security;
alter table growth_scans enable row level security;
alter table harvest_forecasts enable row level security;

-- RLS Policies
create policy "Allow read access for all authenticated farm users" on greenhouse_blocks for select using (true);
create policy "Allow insert for field agents on growth scans" on growth_scans for insert with check (true);
create policy "Allow read access for harvest forecasts" on harvest_forecasts for select using (true);