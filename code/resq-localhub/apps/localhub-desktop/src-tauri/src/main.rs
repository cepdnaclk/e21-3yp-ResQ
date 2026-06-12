mod api_service;
mod broker_service;
mod commands;

use tauri::Manager;

fn stop_managed_services(app_handle: &tauri::AppHandle) {
    let api_state = app_handle.state::<api_service::ApiServiceState>();
    if let Err(error) = api_state.stop() {
        eprintln!("Failed to stop backend during shutdown: {error}");
    }

    let broker_state = app_handle.state::<broker_service::BrokerServiceState>();
    if let Err(error) = broker_state.stop() {
        eprintln!("Failed to stop MQTT broker during shutdown: {error}");
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(api_service::ApiServiceState::default())
        .manage(broker_service::BrokerServiceState::default())
        .setup(|app| {
            eprintln!("LocalHub setup started");
            let app_handle = app.handle().clone();

            eprintln!("Broker start requested");
            let broker_state = app.state::<broker_service::BrokerServiceState>();
            match broker_state.start_with_app(&app_handle) {
                Ok(_) => {
                    eprintln!("Broker start completed successfully or already running");
                }
                Err(error) => {
                    eprintln!("Failed to auto-start MQTT broker: {error}");
                }
            }

            eprintln!("API start requested");
            let api_state = app.state::<api_service::ApiServiceState>();
            match api_state.start_with_app(&app_handle) {
                Ok(status) => {
                    eprintln!(
                        "API start completed successfully: running={}, pid={:?}",
                        status.running, status.pid
                    );
                }
                Err(error) => {
                    eprintln!("Failed to auto-start backend: {error}");
                }
            }

            eprintln!("LocalHub setup completed");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                stop_managed_services(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_network_info,
            commands::get_provisioning_data,
            commands::get_dashboard_urls,
            commands::refresh_pairing_token,
            api_service::start_api_service,
            api_service::stop_api_service,
            api_service::get_api_service_status,
            broker_service::start_broker_service,
            broker_service::stop_broker_service,
            broker_service::get_broker_service_status
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_managed_services(app_handle);
        }
    });
}
