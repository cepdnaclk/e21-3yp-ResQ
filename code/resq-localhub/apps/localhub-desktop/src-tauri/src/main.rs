mod api_service;
mod broker_service;
mod commands;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .manage(api_service::ApiServiceState::default())
        .manage(broker_service::BrokerServiceState::default())
        .setup(|app| {
            let broker_state = app.state::<broker_service::BrokerServiceState>();
            if let Err(error) = broker_state.start() {
                eprintln!("Failed to auto-start MQTT broker: {error}");
            }

            let api_state = app.state::<api_service::ApiServiceState>();
            if let Err(error) = api_state.start() {
                eprintln!("Failed to auto-start backend: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_network_info,
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
