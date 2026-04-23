mod api_service;
mod broker_service;
mod commands;

fn main() {
    tauri::Builder::default()
        .manage(api_service::ApiServiceState::default())
        .manage(broker_service::BrokerServiceState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            api_service::start_api_service,
            api_service::stop_api_service,
            api_service::get_api_service_status,
            broker_service::start_broker_service,
            broker_service::stop_broker_service,
            broker_service::get_broker_service_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
