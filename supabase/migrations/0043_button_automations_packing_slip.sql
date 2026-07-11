-- Allow packing slip PDF as a button automation action.
alter table public.button_automations
  drop constraint if exists button_automations_action_type_check;

alter table public.button_automations
  add constraint button_automations_action_type_check
  check (
    action_type in (
      'copy_link',
      'send_email',
      'send_sms',
      'generate_pdf',
      'generate_packing_slip'
    )
  );
