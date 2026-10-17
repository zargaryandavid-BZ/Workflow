-- Use the readable BZ box label for existing multi-item boxes.
update public.multiitem_boxes
set box_name =
  'BZ BOX ' || box_number::text || ' · ' || to_char(box_date, 'MM/DD/YY')
where box_name is distinct from
  'BZ BOX ' || box_number::text || ' · ' || to_char(box_date, 'MM/DD/YY');
